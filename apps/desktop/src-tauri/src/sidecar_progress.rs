// Pure reducer over the sidecar's output lines: decides WHEN to bring up the native MIDI port and
// the app window. Extracted from the reader closure in lib.rs so the start conditions are testable
// without booting Tauri or the real server.

/// Something the shell should do as a result of the line just observed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarAction {
    /// The server has bound its socket.
    Listening,
    /// Bring up the CoreMIDI virtual destination.
    StartNativeMidi,
    /// Navigate the app window to the local origin.
    OpenAppWindow,
    /// The sidecar reported a host token that differs from the one we injected.
    HostTokenChanged(String),
}

/// Accumulated boot progress. One instance lives for the sidecar's lifetime.
#[derive(Debug, Default)]
pub struct SidecarProgress {
    listening: bool,
    midi_started: bool,
    window_opened: bool,
    observed_token: Option<String>,
}

/// Extract the per-run host-session token from a banner line (`Host token: <hex>`).
pub fn parse_host_token(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"Host token: ([^\s]+)").unwrap();
    re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

impl SidecarProgress {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one COMPLETE output line in and return the actions it triggers.
    pub fn observe(&mut self, line: &str) -> Vec<SidecarAction> {
        let mut actions = Vec::new();

        if let Some(token) = parse_host_token(line) {
            if self.observed_token.as_deref() != Some(token.as_str()) {
                self.observed_token = Some(token.clone());
                actions.push(SidecarAction::HostTokenChanged(token));
            }
        }

        if !self.listening && line.contains("listening on") {
            self.listening = true;
            actions.push(SidecarAction::Listening);
        }

        // #139: the ONLY precondition is that the server is listening. The host token used to gate
        // both of these, which meant an optional banner line (`if (deps.hostToken) console.log(...)`
        // in apps/server/src/boot.ts) — or a line mangled by the merged stdout/stderr buffer — could
        // silently prevent the `LEDrums` MIDI destination from ever existing. The shell now mints
        // the token itself and injects it, so it is always in hand before the sidecar starts.
        if self.listening {
            if !self.midi_started {
                self.midi_started = true;
                actions.push(SidecarAction::StartNativeMidi);
            }
            if !self.window_opened {
                self.window_opened = true;
                actions.push(SidecarAction::OpenAppWindow);
            }
        }

        actions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Replay a whole transcript and collect every action, in order.
    fn replay(lines: &[&str]) -> Vec<SidecarAction> {
        let mut progress = SidecarProgress::new();
        lines.iter().flat_map(|l| progress.observe(l)).collect()
    }

    /// The banner a sidecar prints when a tunnel IS configured (PIN + host token).
    const BANNER_WITH_TOKEN: &[&str] = &[
        "LEDrums server listening on http://localhost:4178 [voice engine]",
        "  LAN: http://192.168.1.10:4178",
        "OSC listening on udp:9000",
        "Pixel output: set target IP + Arm in the UI",
        "  Room PIN: 481923 (required to join)",
        "  Host token: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    ];

    #[test]
    fn starts_the_midi_port_on_a_normal_banner() {
        assert!(replay(BANNER_WITH_TOKEN).contains(&SidecarAction::StartNativeMidi));
    }

    // ---------------------------------------------------------------------
    // #139 — the port must not depend on an optional log line existing.
    // ---------------------------------------------------------------------

    #[test]
    fn starts_the_midi_port_when_the_banner_never_prints_a_host_token() {
        // A sidecar whose host token is not banner-printed (the conditional
        // `if (deps.hostToken) console.log(...)` in apps/server/src/boot.ts).
        let lines = [
            "LEDrums server listening on http://localhost:4178 [voice engine]",
            "  LAN: http://192.168.1.10:4178",
            "OSC listening on udp:9000",
            "Pixel output: set target IP + Arm in the UI",
        ];
        assert!(
            replay(&lines).contains(&SidecarAction::StartNativeMidi),
            "the LEDrums MIDI destination must come up once the server is listening, \
             whether or not a host token was ever printed",
        );
    }

    #[test]
    fn starts_the_midi_port_when_the_host_token_line_is_corrupted() {
        // stdout and stderr are merged into ONE line buffer by the reader, so a stderr write
        // (cloudflared is spawned moments after the banner) can land mid-line and defeat the regex.
        let lines = [
            "LEDrums server listening on http://localhost:4178 [voice engine]",
            "  Host tok2026-07-26T00:00:00Z INF Requesting new quick tunnelen: a1b2c3d4",
        ];
        assert!(
            replay(&lines).contains(&SidecarAction::StartNativeMidi),
            "a mangled banner line must not be able to suppress the MIDI destination",
        );
    }

    #[test]
    fn opens_the_app_window_when_no_host_token_is_printed() {
        let lines = ["LEDrums server listening on http://localhost:4178"];
        assert!(
            replay(&lines).contains(&SidecarAction::OpenAppWindow),
            "the app window is gated on the same scrape and must not be either",
        );
    }

    #[test]
    fn starts_the_midi_port_exactly_once() {
        let actions = replay(BANNER_WITH_TOKEN);
        assert_eq!(
            actions
                .iter()
                .filter(|a| **a == SidecarAction::StartNativeMidi)
                .count(),
            1,
        );
    }

    #[test]
    fn reports_a_host_token_that_differs_from_the_injected_one() {
        let mut progress = SidecarProgress::new();
        progress.observe("LEDrums server listening on http://localhost:4178");
        let actions = progress.observe("  Host token: deadbeefdeadbeefdeadbeefdeadbeef");
        assert!(actions.contains(&SidecarAction::HostTokenChanged(
            "deadbeefdeadbeefdeadbeefdeadbeef".to_string()
        )));
    }

    #[test]
    fn does_not_re_report_the_same_host_token() {
        let mut progress = SidecarProgress::new();
        progress.observe("  Host token: abc123");
        let again = progress.observe("  Host token: abc123");
        assert!(again.is_empty(), "got {again:?}");
    }

    #[test]
    fn ignores_lines_before_the_server_is_listening() {
        let mut progress = SidecarProgress::new();
        let actions = progress.observe("some unrelated startup chatter");
        assert!(actions.is_empty(), "got {actions:?}");
    }

    #[test]
    fn parses_a_host_token_from_a_banner_line() {
        assert_eq!(
            parse_host_token("  Host token: a1b2c3d4e5f6").as_deref(),
            Some("a1b2c3d4e5f6")
        );
        assert_eq!(parse_host_token("  Room PIN: 481923 (required to join)"), None);
    }
}
