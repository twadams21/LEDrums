---
name: audio-midi-inputs
description: Verify explicit audio capture and selected-port MIDI timing without touching real inputs or physical output.
last_updated: 2026-09-07
---

# Audio and MIDI timing verification

Source: Trent's confirmed GH #214 spec and integration checks, 2026-09-07.

1. Keep capture opt-in. Do not request real microphone access during automated verification.
   Inject capture dependencies in unit tests; in browser smoke tests replace getUserMedia with a
   synthetic oscillator → MediaStreamDestination stream before page startup. Assert zero calls
   before Enable, nonzero meters after Enable, and released tracks/zero features after Stop.
2. Exercise the real controller in a mounted AudioInputPanel, not only a mock store. Cover Stop
   during pending permission/resume: release already-created resources immediately and dispose
   a stream arriving after cancellation. Old async attempts must not clear newer ownership.
3. Connect Audio to an exposed effect/modifier parameter. A zero base brightness and a synthetic
   nonzero level make a useful connected test: server preview bytes dark → lit → dark. A synthetic
   meter screenshot alone does not prove the WS/render path.
4. Inject a WebMIDI port before app startup; select `browser:<id>` and `midiClock` timing. Feed
   Start and 24PPQN pulses through its onmidimessage, then cease pulses. Confirm server Running
   and Lost/not-playing states. Test exact tempo with injected time in core; browser timers and
   screenshots introduce jitter and do not prove physical sync precision.
5. Run the relevant tests/typechecks, regenerate the design system if its sources changed, and
   use `pnpm ui-shot` for affected surfaces. Label synthetic input evidence honestly. Still ask a
   human to check packaged-webview permission, real Ableton routing, device removal and kit latency.
6. Use isolated project data and non-default ports with output disabled. Probe the exact
   `UI_SHOT_BASE` URL first; localhost and 127.0.0.1 can differ under Vite's IPv6 bind. A custom
   unreachable base fails rather than starting a detached default stack. Stop only task-owned
   servers/browser sessions and verify their ports are closed after captures.

Audio is four normalized features, not raw recording or transport authority. Silence/staleness maps
to the target mapping's minimum, not necessarily blackout. One looping Spatial Field voice receives
its own hit context, not all later global hits. Operator walkthrough:
`docs/plans/2026-09-07-spatial-audio/TRY-IT.md`.
