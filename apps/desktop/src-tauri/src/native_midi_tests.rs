// Integration tests for the native CoreMIDI bridge (#139).
//
// These are deliberately NOT mocked. `midir::MidiOutput` enumerates the same CoreMIDI destination
// list (`MIDIGetNumberOfDestinations`) that Ableton reads when you open its MIDI output-target
// menu — so a second `MidiOutput` in-process that can see, open and send to `LEDrums` is exactly
// what Ableton does. The far end is a real loopback HTTP server that records the JSON bodies the
// bridge POSTs, so the whole chain (virtual port → callback → translation → HTTP) is under test
// without booting Tauri or the real sidecar.

#![cfg(all(test, target_os = "macos"))]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use midir::{MidiOutput, MidiOutputPort};

use crate::native_midi::{HostToken, NativeMidiBridge, PORT_NAME};

/// Every test here creates a virtual destination with the SAME name, so they must not overlap.
/// (The Rust test harness runs tests in parallel threads by default.)
fn port_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Take the serialising lock, ignoring poisoning from an unrelated failed test.
fn guard() -> std::sync::MutexGuard<'static, ()> {
    port_lock().lock().unwrap_or_else(|e| e.into_inner())
}

/// A recording HTTP/1.1 stub on a loopback port: reads `Content-Length` framed bodies and forwards
/// each one, in arrival order, over a channel. Answers 204 like the real endpoint.
struct StubServer {
    port: u16,
    bodies: mpsc::Receiver<String>,
    /// Query strings seen, so the test can assert the host token is presented.
    queries: mpsc::Receiver<String>,
}

fn stub_server() -> StubServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stub");
    let port = listener.local_addr().unwrap().port();
    let (body_tx, bodies) = mpsc::channel();
    let (query_tx, queries) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Ok(clone) = stream.try_clone() else {
                continue;
            };
            let mut reader = BufReader::new(clone);
            let mut content_length = 0_usize;
            let mut request_line = String::new();
            let mut line = String::new();
            let mut first = true;
            loop {
                line.clear();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let trimmed = line.trim_end();
                if first {
                    request_line = trimmed.to_string();
                    first = false;
                }
                if trimmed.is_empty() {
                    break;
                }
                if let Some(v) = trimmed.strip_prefix("Content-Length: ") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0_u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                continue;
            }
            let _ = query_tx.send(request_line);
            let _ = body_tx.send(String::from_utf8_lossy(&body).to_string());
            let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n");
        }
    });
    StubServer {
        port,
        bodies,
        queries,
    }
}

/// A stub that ACCEPTS connections but never answers, so every POST costs the bridge its full read
/// timeout. Used to back the forward queue up and exercise the drop path.
fn blackhole_server(stop: Arc<AtomicBool>) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind blackhole");
    let port = listener.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&accepted);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let Ok(stream) = stream else { continue };
            counter.fetch_add(1, Ordering::Relaxed);
            // Hold the socket open without replying; drop it after the bridge's timeout elapses.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(600));
                drop(stream);
            });
        }
    });
    (port, accepted)
}

/// Names currently in the CoreMIDI destination list — the list Ableton shows.
fn destination_names() -> Vec<String> {
    let out = MidiOutput::new("ledrums-test-enumerator").expect("MidiOutput");
    out.ports()
        .iter()
        .map(|p| out.port_name(p).unwrap_or_default())
        .collect()
}

fn ledrums_present() -> bool {
    destination_names().iter().any(|n| n.contains(PORT_NAME))
}

/// Open the `LEDrums` destination the way a sender does.
fn connect_to_ledrums(client: &str) -> midir::MidiOutputConnection {
    let out = MidiOutput::new(client).expect("MidiOutput");
    let target: MidiOutputPort = out
        .ports()
        .into_iter()
        .find(|p| out.port_name(p).unwrap_or_default().contains(PORT_NAME))
        .unwrap_or_else(|| {
            panic!(
                "'{PORT_NAME}' is not in the CoreMIDI destination list; saw {:?}",
                destination_names()
            )
        });
    out.connect(&target, "ledrums-test").expect("connect")
}

/// Poll until the port disappears (CoreMIDI teardown is not instantaneous).
fn wait_until_absent(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !ledrums_present() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    !ledrums_present()
}

fn next_body(stub: &StubServer) -> String {
    stub.bodies
        .recv_timeout(Duration::from_secs(5))
        .expect("stub should receive a forwarded body")
}

// ---------------------------------------------------------------------------
// The port itself
// ---------------------------------------------------------------------------

#[test]
fn advertises_ledrums_as_a_coremidi_destination_a_sender_can_open() {
    let _g = guard();
    let stub = stub_server();
    assert!(
        !ledrums_present(),
        "test started with a stale '{PORT_NAME}' port; saw {:?}",
        destination_names()
    );

    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)))
        .expect("bridge should start");

    assert!(
        ledrums_present(),
        "'{PORT_NAME}' must appear in the destination list Ableton reads; saw {:?}",
        destination_names()
    );
    // Opening it is what "select it as an output target" does.
    let _conn = connect_to_ledrums("ableton-stand-in");

    drop(_conn);
    drop(bridge);
}

#[test]
fn removes_the_port_when_the_bridge_is_dropped() {
    let _g = guard();
    let stub = stub_server();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64))).expect("start");
    assert!(ledrums_present());

    drop(bridge);

    assert!(
        wait_until_absent(Duration::from_secs(3)),
        "'{PORT_NAME}' must disappear on Drop so a dead port can never be selected; saw {:?}",
        destination_names()
    );
}

// ---------------------------------------------------------------------------
// Ingest correctness — real bytes in, JSON out, in order
// ---------------------------------------------------------------------------

#[test]
fn forwards_every_supported_message_type_in_order() {
    let _g = guard();
    let stub = stub_server();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64))).expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    // Channel 1 (status nibble 0) throughout, matching what a DAW sends on its first channel.
    conn.send(&[0x90, 38, 100]).unwrap(); // note on
    conn.send(&[0x80, 38, 64]).unwrap(); // note off
    conn.send(&[0xb0, 7, 64]).unwrap(); // control change
    conn.send(&[0xc0, 3]).unwrap(); // program change

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":true,"t":"midi","velocity":100}"#
    );
    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":false,"t":"midi","velocity":0}"#
    );
    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"controller":7,"t":"cc","value":64}"#
    );
    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"t":"programChange","value":3}"#
    );

    drop(conn);
    drop(bridge);
}

#[test]
fn treats_a_note_on_with_velocity_zero_as_a_note_off() {
    let _g = guard();
    let stub = stub_server();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64))).expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    conn.send(&[0x90, 38, 0]).unwrap();

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":false,"t":"midi","velocity":0}"#
    );

    drop(conn);
    drop(bridge);
}

#[test]
fn reports_channels_one_based_matching_the_webmidi_path() {
    let _g = guard();
    let stub = stub_server();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64))).expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    // Status nibble 0 → channel 1 ... nibble 15 → channel 16. This is the convention
    // `apps/web/src/lib/midi/webmidi.ts` uses and therefore what the server's app-wide MIDI
    // channel filter compares against; a 0-based bridge would silently drop every message.
    conn.send(&[0x90, 36, 1]).unwrap();
    conn.send(&[0x94, 36, 1]).unwrap();
    conn.send(&[0x9f, 36, 1]).unwrap();

    for expected in [1, 5, 16] {
        let body = next_body(&stub);
        assert!(
            body.contains(&format!(r#""channel":{expected}"#)),
            "expected channel {expected} in {body}"
        );
    }

    drop(conn);
    drop(bridge);
}

#[test]
fn presents_the_current_host_token_on_every_post() {
    let _g = guard();
    let stub = stub_server();
    let token = HostToken::new("a".repeat(64));
    let bridge = NativeMidiBridge::start(stub.port, token.clone()).expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    conn.send(&[0x90, 38, 100]).unwrap();
    next_body(&stub);
    let first = stub.queries.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
        first.contains(&format!("hostToken={}", "a".repeat(64))),
        "got {first}"
    );

    // A token correction must reach the ALREADY-RUNNING bridge — the port does not restart.
    token.set("b".repeat(64));
    conn.send(&[0x90, 38, 100]).unwrap();
    next_body(&stub);
    let second = stub.queries.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
        second.contains(&format!("hostToken={}", "b".repeat(64))),
        "got {second}"
    );

    drop(conn);
    drop(bridge);
}

#[test]
fn ignores_message_types_the_server_does_not_accept() {
    let _g = guard();
    let stub = stub_server();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64))).expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    // Pitch bend (0xE0) and channel pressure (0xD0) are not part of the accepted set; the server
    // would answer 400. They must be dropped at the bridge, not forwarded.
    conn.send(&[0xe0, 0, 64]).unwrap();
    conn.send(&[0xd0, 64]).unwrap();
    // A message that IS forwarded, so we can prove the earlier two produced nothing.
    conn.send(&[0x90, 38, 100]).unwrap();

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":true,"t":"midi","velocity":100}"#,
        "the first body received must be the note-on, not a pitch-bend"
    );

    drop(conn);
    drop(bridge);
}

// ---------------------------------------------------------------------------
// Live end-to-end against a REAL server (manual; `--ignored`)
// ---------------------------------------------------------------------------

/// Drive the real bridge against a real running LEDrums server, playing the part of Ableton.
///
/// Not part of the automatic suite because it needs a server. To run it:
///
/// ```text
/// TOKEN=$(openssl rand -hex 32)
/// PORT=4399 OSC_PORT=57155 LEDRUMS_ENGINE=voice LEDRUMS_HOST_TOKEN=$TOKEN \
///   pnpm --filter @ledrums/server exec tsx src/main.ts &
/// LIVE_PORT=4399 LIVE_TOKEN=$TOKEN cargo test --lib live_ -- --ignored --nocapture
/// ```
///
/// A 401 here means the injected-token path regressed; watch the app's Monitor view to see the
/// notes land as `input native-midi -> voice-engine`.
#[test]
#[ignore = "needs a running LEDrums server; see the doc comment"]
fn live_forwards_to_a_real_server() {
    let _g = guard();
    let port: u16 = std::env::var("LIVE_PORT")
        .expect("LIVE_PORT")
        .parse()
        .expect("LIVE_PORT must be a port number");
    let token = std::env::var("LIVE_TOKEN").expect("LIVE_TOKEN");

    let bridge = NativeMidiBridge::start(port, HostToken::new(token)).expect("bridge should start");
    assert!(ledrums_present(), "saw {:?}", destination_names());

    let mut conn = connect_to_ledrums("ableton-stand-in");
    for _ in 0..4 {
        conn.send(&[0x90, 38, 100]).unwrap();
        std::thread::sleep(Duration::from_millis(120));
        conn.send(&[0x80, 38, 0]).unwrap();
        std::thread::sleep(Duration::from_millis(120));
    }
    conn.send(&[0xb0, 7, 64]).unwrap();
    conn.send(&[0xc0, 1]).unwrap();
    std::thread::sleep(Duration::from_millis(800));

    assert_eq!(
        bridge.dropped_count(),
        0,
        "no message should have been dropped at this rate"
    );
    drop(conn);
    drop(bridge);
}

// ---------------------------------------------------------------------------
// Saturation
// ---------------------------------------------------------------------------

#[test]
fn drops_messages_instead_of_blocking_when_the_forward_queue_is_full() {
    let _g = guard();
    let stop = Arc::new(AtomicBool::new(false));
    let (port, _accepted) = blackhole_server(Arc::clone(&stop));

    // Capacity 1 + a server that never answers ⇒ the worker stalls on its first POST and the queue
    // backs up immediately.
    let bridge = NativeMidiBridge::start_with_capacity(port, HostToken::new("t".repeat(64)), 1)
        .expect("start");
    let mut conn = connect_to_ledrums("ableton-stand-in");

    let started = Instant::now();
    for _ in 0..64 {
        conn.send(&[0x90, 38, 100]).unwrap();
    }
    let elapsed = started.elapsed();

    // The MIDI callback must never block on HTTP — it runs on CoreMIDI's delivery thread.
    assert!(
        elapsed < Duration::from_millis(500),
        "sending must not block on the stalled forwarder; took {elapsed:?}"
    );

    let deadline = Instant::now() + Duration::from_secs(3);
    while bridge.dropped_count() == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(
        bridge.dropped_count() > 0,
        "a saturated queue must drop and COUNT messages rather than stall the MIDI thread"
    );

    stop.store(true, Ordering::Relaxed);
    drop(conn);
    drop(bridge);
}
