---
name: audio-midi-inputs
description: Verify explicit audio capture and selected-port MIDI timing without touching real inputs or physical output.
last_updated: 2026-09-14
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

## Named track bridge and timing (2026-09-14)

Source: Trent's in-session build approval and explicit dev-server-only verification restriction;
independent findings in `docs/reports/2026-09-14-track-input-review.md` and
`docs/reports/2026-09-14-device-timing-review.md`.

1. Use **JSON/UDP**, not an OSC encoder, for the loopback track port. Validate foreign-writer
   packets against the protocol schema. Registration/ordering/expiry tests need the real
   `createTrackInputSink` plus host and rendered pixels, not only mocked sink calls. Enforce the
   shared channel filter before raw AND scoped MIDI/CC; still release notes accepted before a
   filter change. Preserve disconnected sequence admission even across bye: a live source may
   return from a port/identity edit with the same nonce, but only a higher-sequence hello on its
   original peer can renew it. A new nonce resets ordering; a delayed old hello cannot.
2. A note's press, release and continuous value are different events. Regular OSC zero can fire
   graphs; `oscValue` must not fire/reset/control. `oscRelease` releases a global momentary control
   without firing a graph. Test a REAL bound blackout plus release and expiry, and configure a
   REAL sequence reset—not an assertion whose fixture has no reset source.
3. Input echoes carry explicit `trackInputId` ownership and `modulationOnly`. Audio/gate/macro
   traffic must not consume trigger/global Learn. Delete owned mirror keys/badges on zero,
   retirement, link/session loss and shutdown; preserve unrelated ordinary OSC. Test offline RGB,
   not meters alone. Offline editors must be able to return to browser capture without enabling it.
4. Synthetic sender departure is best-effort: await bounded **local send completion** before
   closing its socket. Calling `send(bye); close()` can cancel Node's deferred lookup/send.
   Test bind-pending close, missing callbacks and timeouts with fakes. Generated `.maxpat` files
   and passing JS tests do not establish `.amxd` packaging, DSP/pass-through or Live persistence.
5. Run benchmarks only after agents/sweeps/captures are quiet. The driver must refuse selected
   track audio (its workload sends WS features), and must accept 100 Hz ordinary stats with 1 Hz
   timing snapshots. Keep timing metadata independent of the latest ordinary packet. Record exact
   host/workload/warmup, compare matched default kernels and report cold-cache cost too. Window
   percentiles are not run-wide percentiles; preview arrival is not physical light latency. This
   older Mac is not the live Mac, and proportional speedups are not promised.
