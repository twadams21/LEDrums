// Native CoreMIDI bridge: publishes a virtual MIDI DESTINATION named "LEDrums" that any sender on
// the machine (Ableton, an SP sampler, anything reading MIDIGetNumberOfDestinations) can select as
// an output target, and forwards what arrives to the sidecar server's `/api/native-midi`.
//
// #139 — the bridge used to be handed a `String` token scraped out of the sidecar's stdout banner,
// which meant a MIDI port could only exist if an optional log line happened to print AND happened to
// survive the stdout/stderr line buffer intact. The token is now a shared, updatable slot
// ({@link HostToken}) that the desktop shell fills in BEFORE the sidecar is spawned, so port
// creation is independent of anything the server prints.
//
// The port is created against CoreMIDI directly rather than through midir. midir never sets
// `kMIDIPropertyUniqueID`, so CoreMIDI minted a fresh random identity on every launch — and every
// app that remembers MIDI endpoints by uniqueID (Sensory Percussion, Ableton) therefore saw a brand
// new device each time LEDrums started and dropped its routing. The shell now hands the bridge a
// persisted id (see `crate::midi_identity`) and the bridge stamps it onto the endpoint.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Route the shell POSTs its own diagnostics to, so a failure is visible in the app's Monitor
/// instead of only on a stdout nobody sees (a packaged `.app` launched from Finder has none).
const HOST_EVENT_ENDPOINT: &str = "/api/host-event";

/// Per-request socket timeout. Deliberately short: the render path must never wait on HTTP.
const HTTP_TIMEOUT: Duration = Duration::from_millis(250);

/// The per-run host-session token, shared between the desktop shell and the MIDI bridge worker.
///
/// It is a slot rather than a value because the shell learns the token at spawn time (it generates
/// and injects it) but must still be able to CORRECT it if the sidecar reports a different one —
/// e.g. a stale sidecar binary that ignores `LEDRUMS_HOST_TOKEN` and mints its own. Every POST reads
/// the current value, so a correction takes effect on the next message without restarting the port.
#[derive(Clone)]
pub struct HostToken(Arc<Mutex<String>>);

impl HostToken {
    pub fn new(token: impl Into<String>) -> Self {
        Self(Arc::new(Mutex::new(token.into())))
    }

    /// The token to present on the next request. A poisoned lock degrades to an empty token (the
    /// server answers 401) rather than panicking inside the MIDI callback thread.
    pub fn get(&self) -> String {
        self.0.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// Replace the token. Returns true when the value actually changed.
    pub fn set(&self, token: impl Into<String>) -> bool {
        let next = token.into();
        match self.0.lock() {
            Ok(mut g) => {
                let changed = *g != next;
                *g = next;
                changed
            }
            Err(_) => false,
        }
    }
}

/// Severity for {@link report_host_event}; mirrors the server's `HostEventLevel`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HostEventLevel {
    Info,
    Error,
}

impl HostEventLevel {
    fn as_str(self) -> &'static str {
        match self {
            HostEventLevel::Info => "info",
            HostEventLevel::Error => "error",
        }
    }
}

/// JSON-escape a string for the small, hand-built bodies below (no serde_json dependency needed on
/// the non-macOS build). Covers the control characters a diagnostic message can realistically carry.
fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Build the host-event JSON body. Split out so it is unit-testable without a socket.
pub fn host_event_body(level: HostEventLevel, label: &str, detail: Option<&str>) -> String {
    let mut body = format!(
        r#"{{"level":"{}","source":"desktop/native-midi","label":"{}""#,
        level.as_str(),
        json_escape(label),
    );
    if let Some(detail) = detail {
        body.push_str(&format!(r#","detail":"{}""#, json_escape(detail)));
    }
    body.push('}');
    body
}

/// POST a body to a loopback path on the sidecar, presenting the host token. Blocking and
/// short-timeout; callers that must not block (startup, the MIDI callback) run it on a worker.
fn post(port: u16, host_token: &str, path: &str, body: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let _ = stream.set_write_timeout(Some(HTTP_TIMEOUT));
    let _ = stream.set_read_timeout(Some(HTTP_TIMEOUT));
    let request = format!(
        "POST {path}?hostToken={host_token} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut response = [0_u8; 64];
    let n = stream.read(&mut response).unwrap_or(0);
    if n == 0 {
        // Nothing came back within the timeout. Treat as delivered — the request bytes are already
        // on the wire, and blocking the MIDI path to find out is worse than a missed status.
        return Ok(());
    }
    let status = std::str::from_utf8(&response[..n]).unwrap_or("");
    if status.starts_with("HTTP/1.1 2") {
        Ok(())
    } else {
        Err(status.lines().next().unwrap_or("HTTP error").to_string())
    }
}

/// Report a shell-side diagnostic into the server's Monitor stream, off the calling thread.
///
/// This is how "the LEDrums MIDI port failed to come up" becomes visible in the app (#139). It is
/// fire-and-forget by design: startup must not wait on it, and a failure to report a failure is
/// logged and dropped rather than escalated.
pub fn report_host_event(
    port: u16,
    token: HostToken,
    level: HostEventLevel,
    label: String,
    detail: Option<String>,
) {
    std::thread::spawn(move || {
        let body = host_event_body(level, &label, detail.as_deref());
        if let Err(err) = post(port, &token.get(), HOST_EVENT_ENDPOINT, &body) {
            eprintln!("[native-midi] could not report host event ({label}): {err}");
        }
    });
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{sync_channel, SyncSender};
    use std::sync::Arc;
    use std::thread::{self, JoinHandle};

    use coremidi::{Client, Properties, VirtualDestination};
    use serde_json::json;

    use super::{post, report_host_event, HostEventLevel, HostToken};

    /// The name senders see. This is what appears in Ableton's MIDI output-target list.
    pub const PORT_NAME: &str = "LEDrums";
    const ENDPOINT: &str = "/api/native-midi";
    const QUEUE_DEPTH: usize = 1024;

    pub struct NativeMidiBridge {
        /// Disposing this is what removes `LEDrums` from the system destination list.
        destination: Option<VirtualDestination>,
        /// The endpoint's owner; kept alive for as long as the endpoint is published.
        _client: Client,
        sender: Option<SyncSender<String>>,
        worker: Option<JoinHandle<()>>,
        dropped: Arc<AtomicU64>,
    }

    impl NativeMidiBridge {
        /// Create the virtual destination and start forwarding. `token` is read per-POST, so the
        /// port comes up whether or not the token is known to be correct yet.
        ///
        /// `unique_id` is the PERSISTED `kMIDIPropertyUniqueID` for the endpoint (see
        /// `crate::midi_identity`). CoreMIDI would otherwise assign a random one per launch, which
        /// is how a device that Sensory Percussion / Ableton already know turns into a stranger
        /// after every restart.
        pub fn start(port: u16, token: HostToken, unique_id: i32) -> Result<Self, String> {
            Self::start_with_capacity(port, token, unique_id, QUEUE_DEPTH)
        }

        pub fn start_with_capacity(
            port: u16,
            token: HostToken,
            unique_id: i32,
            capacity: usize,
        ) -> Result<Self, String> {
            let (tx, rx) = sync_channel::<String>(capacity);
            let worker_token = token.clone();
            let worker = thread::spawn(move || {
                while let Ok(body) = rx.recv() {
                    if let Err(err) = post(port, &worker_token.get(), ENDPOINT, &body) {
                        eprintln!("[native-midi] post failed: {err}");
                    }
                }
            });

            let dropped = Arc::new(AtomicU64::new(0));
            let callback_dropped = Arc::clone(&dropped);
            let callback_tx = tx.clone();
            let callback_token = token.clone();
            let client = Client::new("LEDrums Native MIDI")
                .map_err(|status| format!("create MIDI client: OSStatus {status}"))?;
            let destination = client
                .virtual_destination(PORT_NAME, move |packet_list| {
                    for packet in packet_list.iter() {
                        for_each_message(packet.data(), |message| {
                            let Some(body) = midi_message_json(message) else {
                                return;
                            };
                            // try_send, never send: this runs on CoreMIDI's delivery thread and must
                            // never block on HTTP. A full queue drops the message.
                            if callback_tx.try_send(body).is_err() {
                                let before = callback_dropped.fetch_add(1, Ordering::Relaxed);
                                eprintln!(
                                    "[native-midi] input queue full; dropping message (total {})",
                                    before + 1
                                );
                                // Report the FIRST drop only — enough to make a lossy bridge visible
                                // in the app without flooding the Monitor from the MIDI thread.
                                if before == 0 {
                                    report_host_event(
                                        port,
                                        callback_token.clone(),
                                        HostEventLevel::Error,
                                        "MIDI input queue overflowed".to_string(),
                                        Some(
                                            "Messages are arriving faster than they can be \
                                             forwarded; some were dropped."
                                                .to_string(),
                                        ),
                                    );
                                }
                            }
                        });
                    }
                })
                .map_err(|status| format!("create virtual MIDI destination: OSStatus {status}"))?;

            // The identity a DAW remembers. A refusal here (most plausibly kMIDIIDNotUnique, -10843,
            // from a stale endpoint still holding the ID) is reported but never fatal: a port with a
            // fresh identity still passes notes, a missing port passes nothing.
            if let Err(status) = destination.set_property(&Properties::unique_id(), unique_id) {
                eprintln!(
                    "[native-midi] could not set the saved endpoint id {unique_id} on \
                     '{PORT_NAME}' (OSStatus {status}); the port is live but DAWs may see it as a \
                     new device"
                );
                report_host_event(
                    port,
                    token.clone(),
                    HostEventLevel::Error,
                    "MIDI port identity not persisted".to_string(),
                    Some(format!(
                        "CoreMIDI refused the saved endpoint id (OSStatus {status}). '{PORT_NAME}' \
                         still works, but your DAW may need it re-selected after a restart."
                    )),
                );
            }

            let bridge = Self {
                destination: Some(destination),
                _client: client,
                sender: Some(tx),
                worker: Some(worker),
                dropped,
            };
            // Log what CoreMIDI is ACTUALLY advertising, not what we asked for — the difference is
            // the whole bug this identity work exists to close.
            println!(
                "[native-midi] virtual destination ready: {PORT_NAME} (uniqueID {:?}, wanted {unique_id})",
                bridge.endpoint_unique_id()
            );
            Ok(bridge)
        }

        /// The `kMIDIPropertyUniqueID` CoreMIDI is actually advertising for the port, read back from
        /// the endpoint. `None` once the port has been disposed, or if the property is unreadable.
        pub fn endpoint_unique_id(&self) -> Option<i32> {
            self.destination
                .as_ref()
                .and_then(|destination| destination.unique_id())
                .map(|id| id as i32)
        }

        /// Messages discarded because the forward queue was full. Surfaced so a saturated bridge is
        /// reportable rather than silently lossy.
        pub fn dropped_count(&self) -> u64 {
            self.dropped.load(Ordering::Relaxed)
        }
    }

    impl Drop for NativeMidiBridge {
        fn drop(&mut self) {
            let dropped = self.dropped_count();
            if dropped > 0 {
                println!("[native-midi] session dropped {dropped} message(s) to a full queue");
            }
            // Dispose the endpoint FIRST: senders stop being able to reach a bridge whose queue is
            // about to go away.
            let _ = self.destination.take();
            let _ = self.sender.take();
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    /// Walk one CoreMIDI packet's bytes, handing each complete MIDI message to `on_message`.
    ///
    /// A single packet can carry SEVERAL messages that share a timestamp — a DAW sending a chord,
    /// or a note-off/note-on pair — so translating only the first byte-run would silently drop
    /// notes. midir used to do this walk on our behalf; owning the CoreMIDI callback means owning
    /// it here. Running status is not supported (CoreMIDI packets carry complete messages), and a
    /// packet that stops making sense is abandoned rather than guessed at, so the cursor can never
    /// desynchronise into inventing messages.
    pub fn for_each_message(packet: &[u8], mut on_message: impl FnMut(&[u8])) {
        let mut cursor = 0;
        while cursor < packet.len() {
            let status = packet[cursor];
            if status & 0x80 == 0 {
                return; // Expected a status byte; the rest cannot be parsed safely.
            }
            let size = match status {
                // Sysex runs to its terminator; an unterminated one owns the rest of the packet.
                0xf0 => match packet[cursor..].iter().position(|byte| *byte == 0xf7) {
                    Some(offset) => offset + 1,
                    None => return,
                },
                0xf1 | 0xf3 => 2,    // MTC quarter frame, song select
                0xf2 => 3,           // song position pointer
                s if s >= 0xf4 => 1, // realtime / undefined system messages
                s if s < 0xc0 => 3,  // note off/on, aftertouch, control change
                s if s < 0xe0 => 2,  // program change, channel pressure
                _ => 3,              // pitch bend
            };
            if cursor + size > packet.len() {
                return; // Truncated tail — nothing trustworthy left.
            }
            on_message(&packet[cursor..cursor + size]);
            cursor += size;
        }
    }

    /// Translate a raw CoreMIDI channel message into the server's WS client-message JSON.
    ///
    /// Channel is reported 1-based (`(status & 0x0f) + 1`), matching the browser WebMIDI path
    /// (`apps/web/src/lib/midi/webmidi.ts`) and therefore the app-wide MIDI channel filter, and a
    /// note-on with velocity 0 is reported as a note-off — both verified against the server in
    /// `native_midi_tests`.
    pub fn midi_message_json(message: &[u8]) -> Option<String> {
        if message.len() < 2 {
            return None;
        }
        let raw_status = *message.first()?;
        let status = raw_status & 0xf0;
        let channel = (raw_status & 0x0f) + 1;

        let value = match status {
            0x80 if message.len() >= 3 => json!({
                "t": "midi",
                "note": message[1],
                "velocity": 0,
                "on": false,
                "channel": channel,
            }),
            0x90 if message.len() >= 3 => {
                let velocity = message[2];
                json!({
                    "t": "midi",
                    "note": message[1],
                    "velocity": velocity,
                    "on": velocity > 0,
                    "channel": channel,
                })
            }
            0xb0 if message.len() >= 3 => json!({
                "t": "cc",
                "controller": message[1],
                "value": message[2],
                "channel": channel,
            }),
            0xc0 => json!({
                "t": "programChange",
                "value": message[1],
                "channel": channel,
            }),
            _ => return None,
        };
        Some(value.to_string())
    }

    #[cfg(test)]
    mod packet_tests {
        use super::*;

        fn messages(packet: &[u8]) -> Vec<Vec<u8>> {
            let mut seen = Vec::new();
            for_each_message(packet, |message| seen.push(message.to_vec()));
            seen
        }

        #[test]
        fn splits_a_packet_carrying_several_messages() {
            // What a DAW sends when a chord and its releases land on one timestamp.
            assert_eq!(
                messages(&[0x90, 38, 100, 0x90, 42, 90, 0x80, 38, 64]),
                vec![vec![0x90, 38, 100], vec![0x90, 42, 90], vec![0x80, 38, 64]]
            );
        }

        #[test]
        fn sizes_two_byte_messages_correctly() {
            assert_eq!(
                messages(&[0xc0, 3, 0x90, 38, 100]),
                vec![vec![0xc0, 3], vec![0x90, 38, 100]]
            );
        }

        #[test]
        fn steps_over_a_sysex_block_without_losing_what_follows() {
            assert_eq!(
                messages(&[0xf0, 0x7e, 0x01, 0xf7, 0x90, 38, 100]),
                vec![vec![0xf0, 0x7e, 0x01, 0xf7], vec![0x90, 38, 100]]
            );
        }

        #[test]
        fn steps_over_single_byte_realtime_messages() {
            assert_eq!(
                messages(&[0xf8, 0x90, 38, 100]),
                vec![vec![0xf8], vec![0x90, 38, 100]]
            );
        }

        #[test]
        fn abandons_a_truncated_message_rather_than_inventing_bytes() {
            assert_eq!(messages(&[0x90, 38]), Vec::<Vec<u8>>::new());
            assert_eq!(
                messages(&[0x90, 38, 100, 0xb0, 7]),
                vec![vec![0x90, 38, 100]]
            );
        }

        #[test]
        fn stops_at_a_byte_that_is_not_a_status_byte() {
            // Running status is not supported; a data byte where a status byte belongs ends the walk.
            assert_eq!(
                messages(&[0x90, 38, 100, 40, 100]),
                vec![vec![0x90, 38, 100]]
            );
        }

        #[test]
        fn handles_an_empty_packet() {
            assert_eq!(messages(&[]), Vec::<Vec<u8>>::new());
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::HostToken;

    pub const PORT_NAME: &str = "LEDrums";

    pub struct NativeMidiBridge;

    impl NativeMidiBridge {
        pub fn start(_port: u16, _token: HostToken, _unique_id: i32) -> Result<Self, String> {
            Ok(Self)
        }

        pub fn dropped_count(&self) -> u64 {
            0
        }
    }
}

pub use imp::NativeMidiBridge;
#[allow(unused_imports)]
pub use imp::PORT_NAME;

#[cfg(test)]
mod body_tests {
    use super::*;

    #[test]
    fn builds_an_info_host_event_body() {
        assert_eq!(
            host_event_body(HostEventLevel::Info, "MIDI port ready", None),
            r#"{"level":"info","source":"desktop/native-midi","label":"MIDI port ready"}"#
        );
    }

    #[test]
    fn builds_an_error_host_event_body_with_detail() {
        assert_eq!(
            host_event_body(HostEventLevel::Error, "MIDI port failed", Some("boom")),
            r#"{"level":"error","source":"desktop/native-midi","label":"MIDI port failed","detail":"boom"}"#
        );
    }

    #[test]
    fn escapes_quotes_and_newlines_in_detail() {
        let body = host_event_body(HostEventLevel::Error, "x", Some("a\"b\nc\\d"));
        assert!(body.contains(r#""detail":"a\"b\nc\\d""#), "got {body}");
    }

    #[test]
    fn host_token_reports_whether_the_value_changed() {
        let token = HostToken::new("first");
        assert_eq!(token.get(), "first");
        assert!(!token.set("first"), "same value is not a change");
        assert!(token.set("second"), "different value is a change");
        assert_eq!(token.get(), "second");
    }

    #[test]
    fn host_token_clones_share_one_slot() {
        let token = HostToken::new("a");
        let clone = token.clone();
        token.set("b");
        assert_eq!(clone.get(), "b");
    }
}
