# Integration result — GH #214

2026-09-07. Scope and implementation choices were confirmed by Trent in the originating session.
This is an experiment in the normal engine/editor, not an OTA release or a hardware validation claim.

## Implemented

- Normal CPU Spatial Field effect over world XYZ, with bounded voice-local disturbance state.
- Explicit selected-input audio capture, local gain/noise-floor/attack/release, feature meters and
  reusable Level/Bass/Mids/Highs Audio modulation nodes. Raw audio stays local and unrecorded.
- Manual-default, selected-port MIDI Clock via native desktop MIDI or browser WebMIDI, sharing a
  pure injected-time reducer with offline preview. Existing OSC/note/CC routes remain available.

Three fresh Claude Fable/low workers were used, at most two concurrently. Their reports are FIELD-,
AUDIO- and CLOCK-RESULT.md. All three sessions were closed and their worktrees removed after merge.
The unrelated dirty CAD/.mex worktree and unrelated sessions were not touched.

## Practical integration corrections

- Preserve both Clock and Audio in the Input pane and store when merging.
- Re-lock after abrupt tempo changes; expire Start that never receives its first pulse.
- Create/resume AudioContext inside user activation, dispose it on setup failures, and release
  already-created resources immediately when Stop cancels pending permission/resume.
- Add a mounted real AudioController/AudioInputPanel Enable → Stop → Enable regression. A suspected
  reactivity issue was not reproduced; no speculative controller change was made.
- Stack the Audio band Field so the fourth segmented choice does not clip in the narrow inspector.
- Preserve an unresolved browser-clock selection after reconnect rather than displaying Native
  while the project still routes browser clock; Native remains an explicit available recovery choice.
- Retain fireEffect's created node for later screenshot selection/mode changes. Fail fast when a
  custom UI_SHOT_BASE is unreachable instead of spawning an unrelated default-port dev stack.

## Checks

Serial suite, at most two Vitest workers per package:

| Package | Passing tests |
| --- | ---: |
| core | 1556 |
| IO | 98 |
| error-ingest worker | 57 |
| protocol | 15 |
| server | 627 |
| web | 2689 |
| desktop release/build scripts | 83 |

Five existing core tests and one existing web test were skipped. A further mounted AudioInputPanel
regression and a missing-local-clock-port regression were added after the full sweep; final focused
capture/store-audio and clock helper/store tests pass separately.
All package typechecks passed; final web Svelte check reports zero errors/warnings. Dead-code
configuration/baseline verification passed. Design system regenerated from combined sources.
Rust was formatted locally; native compilation is left to the desktop CI check, not claimed here.

Connected system-Chrome smoke, isolated preview on localhost:5374, output disabled:

1. Replace getUserMedia before boot with a 110Hz oscillator → MediaStreamDestination stream.
   Assert no capture request at boot; click real Enable; run real capture/analyser, normalized WS
   messages and authoritative rendering. Level exceeded 0.8 and field preview bytes became nonzero.
2. Click real Stop. Assert captured track released once and mapped zero-base-brightness field
   returned to dark. No actual microphone or system audio was requested.
3. Inject a synthetic WebMIDI port before boot, select it with `midiClock`, feed Start and pulses
   through its real parser and WS route. Server reported Running/locked; after stopping pulses,
   Lost/not-playing. Browser timers have jitter: this proves routing/recovery, not timing precision.
4. No browser console/page errors in the successful smoke. Strict `pnpm ui-shot` captures and visual
   inspection cover Audio settings Running/denied, Audio inspector, MIDI Clock Manual; extra smoke
   captures cover real analyser meters and Clock Running/Lost. Field full-app/controls were captured
   earlier against the connected engine. A cropped header is not treated as kit evidence.

Warm generator-only sample on this Intel Mac: 2192 pixels, 500 frames, no emissions, median 0.844ms,
p95 1.356ms. This is neither worst-case polyphony nor hit-to-light latency.

## Not established by these checks

- Real Ableton loopback/device routing, packaged WKWebView capture permission/support, physical
  input disconnect behavior, native MIDI timing precision and perceived physical kit latency.
- Every later global hit disturbing a single looping field: existing voice-local hit semantics are
  intentionally retained. Use repeated one-shot voices for separate hit-origin disturbances.
- Audio beat detection, Ableton Link, automatic system capture or a GPU runtime: none added.

See TRY-IT.md for the operator sequence. Audio requires explicit routing to an available input;
clock requires Ableton Sync on the selected output. No desktop release is published by this task.
