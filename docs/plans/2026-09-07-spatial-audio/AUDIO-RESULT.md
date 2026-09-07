# A1 — Audio modulation: implementation report

Branch `feat/audio-modulation` (worktree `ledrums-wt/audio-modulation`), base `origin/main` 5c4d63bb.
Implementation commit: **`ca304a0f`** (`feat(audio): audio modulation source — level/bass/mids/highs (#214)`).
Not pushed, no PR, no merge, no `.mex`/CAD changes, no design-system regeneration, no ui-shot — those are the
parent's integration steps per the brief.

## What shipped

**Core (`packages/core/src/voice`)** — pure, no IO
- `audio-features.ts`: `AUDIO_BANDS` (`level|bass|mids|highs`), `AudioFeatureFrame`, `audioFeatureFrameSchema`
  (zod, finite 0..1, strict), `normalizeAudioFrame`/`audioValue01`, `AudioTable {frame, atMs}`, `AUDIO_STALE_MS = 500`,
  and the ONE sampling function `sampleAudio(table, band, timeMs)` (0 when absent, stale, unknown band, or non-finite clock).
- `modulation.ts`: `ModSource` gains `{ kind: 'audio'; band }`; `ModSampleCtx.audio?: AudioTable`; `sampleSource` case
  delegates to `sampleAudio(ctx.audio, band, ctx.timeMs)` — so freshness rides the frame clock every sampling path already
  carries (effect params, modifier links via `writeModCtx`, nested Mix/Splice members, generator `renderVoice`).
- `modulation-graph.ts`: `'audio'` in `MOD_SOURCE_KINDS`; `nodeModSource` → `{kind:'audio', band: node.audioBand ?? 'level'}`.
- `types.ts`: `NodeKind` `'audio'`, `GraphNode.audioBand?: AudioBand`. `render-plan.ts` (modulation-source), `eval-graph.ts` (inert).
- `engine.ts`: `InputEvent.kind` `'audioFeatures'` with `audio?: AudioFeatureFrame`; engine-owned `audioTable` written only in the
  queue drain (`{frame: normalizeAudioFrame(e.audio), atMs: e.timeMs}`), returns BEFORE any trigger resolution; cleared on
  `setShow`; threaded to `applyEffectiveParams` and `CompositorFrame.audio`.
- `compositor.ts`: `applyEffectiveParams(..., audio?)`, `CompositorFrame.audio`, `FrameModCtx`/`writeModCtx` carry it.

**Protocol (`packages/protocol`)** — `t:'audioFeatures'` strict message, flat `level,bass,mids,highs`, constraints spread from
`voice.audioFeatureFrameSchema.shape` (single definition). No client timestamp (rejected as an unknown key).

**Server (`apps/server`)**
- `VoicePartialInput` `audioFeatures`; `toInputEvent` stamps `timeMs = engineTimeMs` (host clock is the freshness authority).
- `applyInput` skips the input→frame latency mark for audio frames (a 30 Hz stream must not own the latency measurement).
- `handlers/voice-input.ts`: applies only when `!deps.viewer`; no input echo, no monitor event; legacy mode consumes as no-op.
- `client-message.ts`: `audioFeatures` is NOT in `ENGINE_INPUTS`, so the deny-by-default editor gate silently drops a
  viewer's frames (test pins `requiresEditor('audioFeatures') === true`). Belt + brace with the handler's viewer check.

**Web (`apps/web/src/lib`)**
- `audio/analysis.ts` (pure): RMS level (full-scale sine → 0 dBFS), band power = SUM of linear bin power → dB
  (+`BAND_CALIBRATION_DB` 10, documented approximate), `dbToUnit` maps `[noiseFloorDb, 0]`→`[0,1]` after gain
  (`20·log10(gain)`, 0..4), dt-derived attack/release lag, sample-rate-aware `bandBins` clipped at Nyquist. No AGC. All outputs
  finite 0..1 (−∞ bins, NaN, gain 0 → 0). `sanitizeAudioAnalysisSettings` + documented ranges.
- `audio/capture.ts`: injected `AudioCaptureDeps` (getUserMedia, enumerateInputs, createContext, timer, now, devicechange) with
  `browserAudioCaptureDeps()` feature-detecting secure context / mediaDevices / AudioContext. `AudioCaptureSession`: FFT **2048**
  (documented: 23 Hz/bin at 48 kHz keeps ~10 bins in bass; 4096 doubles latency for no gain), `smoothingTimeConstant 0`,
  ≤30 Hz managed interval (`AUDIO_FEATURE_INTERVAL_MS`), source→analyser ONLY (never destination), two reused Float32Arrays,
  `echoCancellation/noiseSuppression/autoGainControl: false`, `deviceId {exact}` or default. Per the parent's spool:
  the AudioContext is created and `resume()` issued **synchronously before the getUserMedia await** (activation), and startup
  is exception-safe — any throw / stop / restart during either await releases tracks + context (`CaptureFailure`/`CANCELLED`
  routed through one cleanup path). Track `ended` → zero frame + `device-lost`; context `suspended/interrupted` → zero frame +
  `suspended`, resumes on `running`; stop emits exactly one zero frame, idempotent.
- `trigger-lab/audio-controller.svelte.ts`: runes state (status/error/message/trackLabel/sampleRate/meter/devices/deviceId/
  settings), localStorage `ledrums.audio-input.v1` (device id + gain/floor/attack/release; **not** in the show), viewer refused
  at `start`, `enforceOwnership(isViewer)` called from the store's rAF loop, `dispose()` on `store.stop()`,
  `previewSynthetic` for the dev seam only.
- `trigger-lab/sim.ts`: `audioTable` + `setAudio(frame)` stamped at sim time; threaded to `applyEffectiveParams` and
  `renderPresentation` (`audio:`), included in the presentation revision key.
- `trigger-lab/store.svelte.ts`: `audio` controller wiring; `forwardAudio` → `sim.setAudio` always (local preview + node faces)
  and ONE `audioFeatures` send only while `link === 'open'` (`send` drops when closed → no stale queue on reconnect);
  `addNode('audio')` seeds `audioBand:'level'`; `changeKind` → audio; `audioNodeBand/setAudioNodeBand` (undo snapshot, writes
  through the graph's reactive node); `audioNodeLiveValue` via `sampleAudio(sim.audioTable, band, sim.timeMs)`; getters +
  `startAudio/stopAudio/setAudioDevice/setAudioSettings/refreshAudioDevices/previewAudioMeter`.
- Node UI: `trigger-node-meta` (AudioLines icon, modulation tint, label "Audio", summary "Audio · Bass"),
  `trigger-flow-projection`, `sim.graph-compilation` `NODE_KINDS` (Add menu's Modulate family + inspector re-type list pick it up
  through `isModSourceKind`), `TriggerNode` face (`NodeSignalPreview kind="audio"` bar + `%` readout), `Inspector` →
  `AudioNodeInspector.svelte` (live value, Band segmented Select, "input is off" notice). Blue modulation wire semantics unchanged
  (edges from a mod-source kind).
- Settings: `chrome/AudioInputPanel.svelte` in `InputPane` — Input Select (Default input + devices; unnamed until permission),
  Enable (primary) / Stop, `StatusPill` per state with actionable copy (denied / no device / unsupported / suspended / lost / failed),
  track label + sample rate when running, four `LevelMeter`s (Level/Bass/Mids/Highs), Gain (notch at unity, dB readout) /
  Noise floor / Attack / Release Sliders, the routing help sentence verbatim. Viewer: controls disabled + note. Never requests on
  load. Section subtitle now "MIDI, OSC + audio into the rig".
- `ui/LevelMeter.svelte` (new reusable, `role="meter"`, tabular readout) + styleguide `SectionPrimitives` "Level meter" card;
  `SectionComposites` face-sub map gains `audio`. `docs/design-system.html` NOT regenerated (parent does it once).
- `shot-seam.ts`: `audio-meter[:running|denied|lost|unsupported|off]` stages status + synthetic frame (sets the sim table so
  Audio node faces read it); `add:audio,select:audio` works through the existing generic seam.

**Desktop**: `apps/desktop/src-tauri/Info.plist` with `NSMicrophoneUsageDescription` (Tauri 2 merges `src-tauri/Info.plist`).
No native capture backend, no entitlement changes, no drivers. MIDI clock / WebMIDI / native_midi.rs untouched.

## Tests (all green, run per package; no full sweep per the brief)

| package | files | tests | what they prove |
|---|---|---|---|
| core | `audio-features.test.ts`, `modulation-audio.test.ts` (+ 8 neighbouring modulation/graph suites re-run) | 183 | schema rejection; `sampleAudio` freshness/absent/NaN; graph resolution onto effect AND modifier carriers; engine: frame drives effect param, drives modifier param (hue-shift red→cyan through the real compositor), band isolation, stale→0 with no new event, never fires a graph / no diagnostics, malformed frame normalised, `setShow` clears, determinism |
| protocol | `schemas.test.ts` | 14 | valid frame; missing band, >1, <0, NaN, ±Infinity, extra key, wrong type rejected; discriminant set |
| server | `voice-input.test.ts`, `client-message.test.ts` (+ ws-protocol, host) | 114 | editor frame lights a voice with zero broadcasts; viewer frame dropped; no voice spawned; stale on HOST clock; legacy no-op; `requiresEditor('audioFeatures')` |
| web | `audio/analysis.test.ts` (20), `audio/capture.test.ts` (17), `audio-controller.test.ts` (8), `store.audio-source.test.ts` (5), `LevelMeter.test.ts` (2), `InputPane.test.ts` (9) + 18 affected suites | 234 | synthetic silence/sine/per-band tone/sample-rate edges/gain/floor/smoothing/finiteness; capture start/stop/cancel-during-prompt/restart/ended/suspended + resume rejection, analyser/source throw, stop-during-resume cleanup; controller ownership/persistence/dispose/unsupported; node add/band edit/undo/re-type, show-library persistence round-trip, offline sim parity (node face + live voice param, stale→0); meter clamping/aria; pane states + Enable/Stop wiring |

Typecheck: `tsc --noEmit` green for core, protocol, server; `svelte-check` 0 errors for web.

## Deviations / decisions to know about

- **Wire shape**: flat fields on the `audioFeatures` envelope (chosen once; core event carries a nested `audio` frame object —
  the host maps between them).
- **Band power sums linear bin power** (energy) rather than averaging: a tone reads the same in any band width; documented
  `BAND_CALIBRATION_DB = 10` is an approximation of Blackman-window loss + main-lobe spread, not a measured constant.
- **`audioFeatures` stays editor-gated** (not an ungated engine input): a viewer's frames are dropped silently by the existing
  gate, and again by the handler. Standalone/first client is the editor, so the single-user case just works.
- **Ownership release** is enforced from the store's rAF loop (`enforceOwnership(isViewer)`) rather than a presence callback — one
  cheap check per frame, no new subscription.
- `setAudioNodeBand` resolves the graph's reactive node by id before writing (a raw node from `addNode` is not the `$state`
  proxy the canvas/autosave observe). Existing setters (`setOscNodeAddress` etc.) mutate the passed node directly; unchanged.
- The Audio node inspector shows an "input is off" notice rather than a start button — capture stays in Settings, one place.

## Caveats / not verified

- **No microphone, Ableton, audio interface or physical kit was tested.** All DSP/lifecycle coverage is synthetic; the
  `BAND_CALIBRATION_DB` offset and the Gain default may want a real-signal pass.
- **WKWebView (desktop)**: `getUserMedia` inside Tauri's WKWebView needs the usage string (added) and the host app to grant the
  WebKit media-capture permission request (wry's delegate behaviour) — I could not verify this here. If the desktop build
  reports `permission-denied`/`no-device`, that seam is the first suspect; the browser build is unaffected.
- `enumerateDevices` labels are empty until permission is granted once; the panel says so and refreshes after Enable.
- Design-system HTML not regenerated; no ui-shot captured (parent). Full `pnpm test`/`pnpm typecheck` not run (worker rule);
  targeted suites above only.
