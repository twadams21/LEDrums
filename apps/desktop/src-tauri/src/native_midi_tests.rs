// Integration tests for the native CoreMIDI bridge (#139).
//
// These are deliberately NOT mocked. The sender below is a real CoreMIDI output port opened against
// the real system destination list (`MIDIGetNumberOfDestinations`) — the same list Ableton reads
// when you open its MIDI output-target menu — so "a DAW selects LEDrums and plays notes at it" is
// literally what runs. The far end is a real loopback HTTP server that records the JSON bodies the
// bridge POSTs, so the whole chain (virtual port → callback → translation → HTTP) is under test
// without booting Tauri or the real sidecar.
//
// Endpoints are selected by kMIDIPropertyUniqueID, never by name. A real LEDrums app is very often
// running on the developer's machine, publishing a destination with exactly the same NAME; matching
// on the name would quietly point the tests at the drummer's live rig instead of the bridge under
// test. Every assertion about the system list is likewise a diff or an identity lookup, never an
// absolute count.

#![cfg(all(test, target_os = "macos"))]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use coremidi::{Client, Destination, Destinations, OutputPort, PacketBuffer};

use crate::midi_identity::generate_unique_id;
use crate::native_midi::{HostToken, NativeMidiBridge, PORT_NAME};

/// A throwaway endpoint id for a test bridge. Derived the same way the shipped one is (clock + pid),
/// so it cannot collide with a real LEDrums app's persisted id on this machine — CoreMIDI refuses a
/// duplicate uniqueID, which would otherwise fail these tests for the wrong reason.
fn test_unique_id() -> i32 {
    generate_unique_id()
}

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

// ---------------------------------------------------------------------------
// Looking at the system destination list the way a DAW does
// ---------------------------------------------------------------------------

/// `(display name, uniqueID)` for every destination in the system — what a DAW's output-target menu
/// is built from. Only ever used for diffs and diagnostics.
fn destination_summary() -> Vec<(String, Option<i32>)> {
    Destinations
        .into_iter()
        .map(|destination| {
            (
                destination.display_name().unwrap_or_default(),
                destination.unique_id().map(|id| id as i32),
            )
        })
        .collect()
}

/// The destination carrying a specific endpoint identity, or `None` if nothing advertises it.
fn destination_with_id(unique_id: i32) -> Option<Destination> {
    Destinations
        .into_iter()
        .find(|destination| destination.unique_id() == Some(unique_id as u32))
}

fn is_published(unique_id: i32) -> bool {
    destination_with_id(unique_id).is_some()
}

/// Poll until the endpoint disappears (CoreMIDI teardown is not instantaneous).
fn wait_until_absent(unique_id: i32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_published(unique_id) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    !is_published(unique_id)
}

/// A sender playing Ableton's part: a real CoreMIDI output port aimed at the endpoint under test.
struct Sender {
    /// Owns the port; must outlive it.
    _client: Client,
    port: OutputPort,
    destination: Destination,
}

impl Sender {
    /// Open the endpoint the way a DAW does once the user picks it as an output target.
    fn open(unique_id: i32) -> Self {
        let destination = destination_with_id(unique_id).unwrap_or_else(|| {
            panic!(
                "no destination advertises uniqueID {unique_id}; saw {:?}",
                destination_summary()
            )
        });
        let client = Client::new("ableton-stand-in").expect("client");
        let port = client.output_port("ableton-stand-in").expect("output port");
        Self {
            _client: client,
            port,
            destination,
        }
    }

    /// Send one MIDI message immediately (timestamp 0 = now).
    fn send(&self, message: &[u8]) {
        let packet = PacketBuffer::new(0, message);
        self.port
            .send(&self.destination, &packet)
            .expect("send to the destination under test");
    }
}

fn next_body(stub: &StubServer) -> String {
    stub.bodies
        .recv_timeout(Duration::from_secs(5))
        .expect("stub should receive a forwarded body")
}

/// Start a bridge with a fresh identity, returning it alongside that identity.
fn start_bridge(stub: &StubServer) -> (NativeMidiBridge, i32) {
    let unique_id = test_unique_id();
    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)), unique_id)
        .expect("bridge should start");
    (bridge, unique_id)
}

// ---------------------------------------------------------------------------
// The port itself
// ---------------------------------------------------------------------------

#[test]
fn advertises_ledrums_as_a_coremidi_destination_a_sender_can_open() {
    let _g = guard();
    let stub = stub_server();

    let (bridge, unique_id) = start_bridge(&stub);

    let published = destination_with_id(unique_id).unwrap_or_else(|| {
        panic!(
            "the bridge's endpoint must appear in the destination list Ableton reads; saw {:?}",
            destination_summary()
        )
    });
    assert!(
        published
            .display_name()
            .unwrap_or_default()
            .contains(PORT_NAME),
        "the endpoint must be presented under the name a drummer looks for"
    );
    // Opening it is what "select it as an output target" does.
    let sender = Sender::open(unique_id);

    drop(sender);
    drop(bridge);
}

#[test]
fn removes_the_port_when_the_bridge_is_dropped() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    assert!(is_published(unique_id));

    drop(bridge);

    assert!(
        wait_until_absent(unique_id, Duration::from_secs(3)),
        "the endpoint must disappear on Drop so a dead port can never be selected; saw {:?}",
        destination_summary()
    );
}

// ---------------------------------------------------------------------------
// Endpoint identity — the thing DAWs remember a device by
// ---------------------------------------------------------------------------

#[test]
fn adds_exactly_one_destination_to_the_system_list() {
    let _g = guard();
    let stub = stub_server();
    let unique_id = test_unique_id();
    // Baseline taken immediately before starting, and compared as a DIFF: other apps (including a
    // real LEDrums) publish endpoints of their own, so the absolute count means nothing.
    let before = Destinations::count();

    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)), unique_id)
        .expect("start");

    assert_eq!(
        Destinations::count(),
        before + 1,
        "the bridge must publish exactly one endpoint — not zero, and not a duplicate; saw {:?}",
        destination_summary()
    );
    drop(bridge);
}

#[test]
fn publishes_the_unique_id_it_was_given() {
    let _g = guard();
    let stub = stub_server();
    let unique_id = test_unique_id();

    let bridge = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)), unique_id)
        .expect("start");

    assert_eq!(
        bridge.endpoint_unique_id(),
        Some(unique_id),
        "kMIDIPropertyUniqueID must be the caller's value, not the random one CoreMIDI assigns"
    );
    let published = destination_with_id(unique_id);
    assert!(
        published.is_some(),
        "a DAW enumerating destinations must see that identity; saw {:?}",
        destination_summary()
    );

    drop(bridge);
}

#[test]
fn reuses_the_same_unique_id_after_a_restart() {
    let _g = guard();
    let stub = stub_server();
    // The persisted id: the SAME value the shell loads from disk on the next launch.
    let unique_id = test_unique_id();

    let first = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)), unique_id)
        .expect("start");
    assert_eq!(first.endpoint_unique_id(), Some(unique_id));
    drop(first);
    assert!(
        wait_until_absent(unique_id, Duration::from_secs(3)),
        "the first port must be gone before the restart; saw {:?}",
        destination_summary()
    );

    let second = NativeMidiBridge::start(stub.port, HostToken::new("t".repeat(64)), unique_id)
        .expect("restart");

    assert_eq!(
        second.endpoint_unique_id(),
        Some(unique_id),
        "a restart must present the SAME endpoint identity, or every DAW treats it as a new device \
         and forgets its routing"
    );
    drop(second);
}

// ---------------------------------------------------------------------------
// Ingest correctness — real bytes in, JSON out, in order
// ---------------------------------------------------------------------------

#[test]
fn forwards_every_supported_message_type_in_order() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    let sender = Sender::open(unique_id);

    // Channel 1 (status nibble 0) throughout, matching what a DAW sends on its first channel.
    sender.send(&[0x90, 38, 100]); // note on
    sender.send(&[0x80, 38, 64]); // note off
    sender.send(&[0xb0, 7, 64]); // control change
    sender.send(&[0xc0, 3]); // program change

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

    drop(sender);
    drop(bridge);
}

#[test]
fn forwards_every_message_in_a_packet_that_carries_several() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    let sender = Sender::open(unique_id);

    // One packet, one timestamp, three messages — what a DAW sends for a chord. Translating only
    // the head of the packet would silently swallow the rest.
    sender.send(&[0x90, 38, 100, 0x90, 42, 90, 0x80, 38, 64]);

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":true,"t":"midi","velocity":100}"#
    );
    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":42,"on":true,"t":"midi","velocity":90}"#
    );
    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":false,"t":"midi","velocity":0}"#
    );

    drop(sender);
    drop(bridge);
}

#[test]
fn treats_a_note_on_with_velocity_zero_as_a_note_off() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    let sender = Sender::open(unique_id);

    sender.send(&[0x90, 38, 0]);

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":false,"t":"midi","velocity":0}"#
    );

    drop(sender);
    drop(bridge);
}

#[test]
fn reports_channels_one_based_matching_the_webmidi_path() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    let sender = Sender::open(unique_id);

    // Status nibble 0 → channel 1 ... nibble 15 → channel 16. This is the convention
    // `apps/web/src/lib/midi/webmidi.ts` uses and therefore what the server's app-wide MIDI
    // channel filter compares against; a 0-based bridge would silently drop every message.
    sender.send(&[0x90, 36, 1]);
    sender.send(&[0x94, 36, 1]);
    sender.send(&[0x9f, 36, 1]);

    for expected in [1, 5, 16] {
        let body = next_body(&stub);
        assert!(
            body.contains(&format!(r#""channel":{expected}"#)),
            "expected channel {expected} in {body}"
        );
    }

    drop(sender);
    drop(bridge);
}

#[test]
fn presents_the_current_host_token_on_every_post() {
    let _g = guard();
    let stub = stub_server();
    let token = HostToken::new("a".repeat(64));
    let unique_id = test_unique_id();
    let bridge =
        NativeMidiBridge::start(stub.port, token.clone(), unique_id).expect("bridge should start");
    let sender = Sender::open(unique_id);

    sender.send(&[0x90, 38, 100]);
    next_body(&stub);
    let first = stub.queries.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
        first.contains(&format!("hostToken={}", "a".repeat(64))),
        "got {first}"
    );

    // A token correction must reach the ALREADY-RUNNING bridge — the port does not restart.
    token.set("b".repeat(64));
    sender.send(&[0x90, 38, 100]);
    next_body(&stub);
    let second = stub.queries.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
        second.contains(&format!("hostToken={}", "b".repeat(64))),
        "got {second}"
    );

    drop(sender);
    drop(bridge);
}

#[test]
fn ignores_message_types_the_server_does_not_accept() {
    let _g = guard();
    let stub = stub_server();
    let (bridge, unique_id) = start_bridge(&stub);
    let sender = Sender::open(unique_id);

    // Pitch bend (0xE0) and channel pressure (0xD0) are not part of the accepted set; the server
    // would answer 400. They must be dropped at the bridge, not forwarded.
    sender.send(&[0xe0, 0, 64]);
    sender.send(&[0xd0, 64]);
    // A message that IS forwarded, so we can prove the earlier two produced nothing.
    sender.send(&[0x90, 38, 100]);

    assert_eq!(
        next_body(&stub),
        r#"{"channel":1,"note":38,"on":true,"t":"midi","velocity":100}"#,
        "the first body received must be the note-on, not a pitch-bend"
    );

    drop(sender);
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
    let unique_id = test_unique_id();

    let bridge = NativeMidiBridge::start(port, HostToken::new(token), unique_id)
        .expect("bridge should start");
    assert!(is_published(unique_id), "saw {:?}", destination_summary());

    let sender = Sender::open(unique_id);
    for _ in 0..4 {
        sender.send(&[0x90, 38, 100]);
        std::thread::sleep(Duration::from_millis(120));
        sender.send(&[0x80, 38, 0]);
        std::thread::sleep(Duration::from_millis(120));
    }
    sender.send(&[0xb0, 7, 64]);
    sender.send(&[0xc0, 1]);
    std::thread::sleep(Duration::from_millis(800));

    assert_eq!(
        bridge.dropped_count(),
        0,
        "no message should have been dropped at this rate"
    );
    drop(sender);
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
    let unique_id = test_unique_id();

    // Capacity 1 + a server that never answers ⇒ the worker stalls on its first POST and the queue
    // backs up immediately.
    let bridge =
        NativeMidiBridge::start_with_capacity(port, HostToken::new("t".repeat(64)), unique_id, 1)
            .expect("start");
    let sender = Sender::open(unique_id);

    let started = Instant::now();
    for _ in 0..64 {
        sender.send(&[0x90, 38, 100]);
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
    drop(sender);
    drop(bridge);
}
