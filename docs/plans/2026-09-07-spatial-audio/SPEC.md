# Spatial Field + Audio modulation — integrated experiment

Source: Trent's conversation on 2026-09-07 (Trent's MacBook Pro). User approved CPU-only spatial fields plus an Audio modulation node (level/bass/mids/highs), explicit selectable audio/loopback input, and MIDI/OSC musical timing. Requested /to-spec and /twux, Fable/low Claude workers, lightweight verification, and strict cleanup of task-owned sessions/processes/worktrees. No GPU requirement. Integration base: origin/main fec83bee (not the CAD agent's working branch).

## Problem Statement

LEDrums needs a more spatial, continuous way to author light across the drum kit, and continuous musical energy signals to animate effects between precisely timed MIDI/OSC hits. The operator runs Ableton and LEDrums on the same Mac. Audio beat detection is unnecessary when musical timing can be supplied directly.

## Solution

Add a normal CPU-rendered Spatial Field effect: a moving, twisting world-space field, disturbed by hit-centred expanding waves. Add an Audio modulation source that can drive any existing numeric effect/modifier parameter using Level, Bass, Mids or Highs. Provide explicit audio input capture controls and actionable routing/status in Settings. Add opt-in MIDI Clock timing to the existing transport rather than inferring tempo from sound. These are integrated experiments, not a new renderer or a separate prototype app.

## User Stories

1. As a show author, I want Spatial Field in the normal effect library so I can use it in existing graphs.
2. As a show author, I want a pattern continuous across world coordinates so my drums read as one spatial instrument.
3. As a show author, I want scale, twist, speed and disturbance controls so I can shape the field.
4. As a performer, I want a struck drum to originate an expanding disturbance so the light follows the gesture.
5. As a performer, I want velocity to affect the disturbance so dynamics remain expressive.
6. As a show author, I want standard hue, saturation and brightness controls so the field fits my palette.
7. As a show author, I want Scope, Mix, modifiers and envelopes to work unchanged with the new effect.
8. As a show author, I want a useful default look and live thumbnail so I can find and audition it.
9. As a performer, I want the effect to work without a GPU-specific backend or external graphics runtime.
10. As a rig builder, I want to choose an audio input explicitly so I can route Ableton using my audio interface or an already-installed loopback device.
11. As a performer, I want capture to start only after I enable it so microphone access is never a surprise.
12. As a performer, I want clear unavailable, permission-denied, starting, running, stopped and device-lost feedback.
13. As a performer, I want Level, Bass, Mids and Highs meters so I can prove signal is arriving before mapping it.
14. As a performer, I want input gain, a noise floor and smoothing so silence stays quiet and response is controllable.
15. As a show author, I want an Audio node in Modulate so I can wire energy into existing parameters.
16. As a show author, I want the Audio source's band selection to be saved with my graph.
17. As a show author, I want existing target-side mapping ranges to remain authoritative.
18. As a performer, I want the connected server to render from audio features so preview and physical output agree.
19. As a performer, I want offline preview to consume the same feature values without double forwarding.
20. As a performer, I want capture stop, input loss or browser disconnection to make audio modulation return to zero rather than freeze.
21. As a performer, I want only compact numeric feature frames forwarded, not raw audio recorded or uploaded.
22. As a performer, I want capture resources released on stop, replacement or app disposal.
23. As a performer, I want MIDI Clock to follow Ableton's tempo and start/continue/stop when I explicitly select external sync.
24. As a performer, I want manual timing to remain the default so unsolicited clock cannot take over my show.
25. As a performer, I want clock-loss status and a documented deterministic fallback instead of an unexplained frozen or running clock.
26. As a desktop user, I want the existing native MIDI destination to accept clock as well as the WebMIDI route.
27. As a show author, I want a reproducible example and concise Ableton routing instructions so I can try these features without building a complex graph first.
28. As a maintainer, I want deterministic numerical tests and bounded processing so the experiment does not destabilize live lighting.

## Implementation Decisions

- Reuse the EffectGenerator seam and current float framebuffer/compositing pipeline. Spatial Field samples physical LED world XYZ, never preview-camera/screen pixels. One normal generator, no special graph branch. Source positions use the existing effect-origin geometry. Bounded per-voice hit state; no hidden globals. Existing voice semantics remain explicit: one-shot voices layer their own disturbances; no new global cross-voice event subscription.
- Add an explicit Audio modulation source to the existing graph-to-mapping and live source sampling architecture. Four fixed feature keys: level, bass, mids, highs, each finite 0..1. Do not masquerade audio as MIDI CC or synthesize OSC triggers.
- Capture and Web Audio analysis live in the web adapter, outside pure core. A pure numeric feature reducer is independently testable with synthetic time-domain/FFT data. No recording, audio monitoring/output, system-audio entitlement, automatic driver installation, or raw-audio network stream.
- Use selectable getUserMedia audio inputs. Capturing Ableton requires routing its signal to an available input (interface loopback or an installed virtual device); sharing a Mac does not make its output a microphone input. Feature-detect and surface WKWebView/permission limitations honestly. Add the desktop microphone usage description if needed; do not assert hardware validation without it.
- Capture defaults off. Keep device identity/config local rather than syncing device IDs into shows. Persist graph source/band choices normally. Use shared design-system fields/status/controls, dense flat settings, readable labels and meters; avoid a new standalone authoring surface.
- Send bounded-rate compact audio feature events over a typed, validated WS member to the authoritative voice host. Timestamp freshness with the host's engine clock, not an untrusted browser clock. Missing/stale audio becomes zero after a short fixed timeout (500ms recommended); stop emits zero immediately. Capture ownership follows edit/host ownership; viewers cannot silently replace the active audio stream. No per-sample monitor spam.
- MIDI Clock is opt-in at transport configuration. Support timing clock (24 PPQN), Start, Continue, Stop, and song-position pointer if straightforward. Parse system messages before channel-message filtering. Use an injected monotonic receipt time, a bounded tempo estimator and explicit phase/transport state; manual mode ignores clock. A selected browser input owns clock to prevent combining multiple sources. Native host MIDI remains available in desktop. Never forward through both browser and native routes intentionally.
- Existing CC, note and OSC modulation remain available. No audio onset/beat/instrument detection. MIDI Clock drives musical transport; do not promise phase-sync for generators that deliberately use absolute seconds.
- Core remains free of Node/DOM/IO. IO adapters never block the render loop. Avoid dependency additions/native addons. Resources and buffers are bounded and reusable.

## Testing Decisions

- Test public behavior at the existing generator, graph/effect render, input dispatch and modulation mapping seams; retain pure numeric helper tests where device-free diagnosis is valuable.
- Spatial Field: deterministic frames, finite bounded output, visible default, spatial movement, velocity-dependent disturbance, model replacement, scoped output, no unbounded emissions.
- Audio: synthetic silence/sine/band bins, gain/floor/smoothing, sample-rate-aware band boundaries; protocol invalid payload rejection; event-to-render mapping for both effect and modifier params; freshness timeout; offline parity; capture cleanup and pending-start cancellation with injected browser adapters.
- Clock: synthetic 24PPQN streams at multiple tempos, jitter/gaps, start/continue/stop, manual ignore, channel independence, duplicate-source prevention and native parser byte fixtures.
- Run targeted worker tests only, serialized typecheck/full suite at integration; no fleet-wide concurrent test sweeps. Capture affected surfaces with ui-shot and regenerate the design system once in the integrated tree. Add deterministic demo seams as needed, never request a real microphone in screenshot automation.
- Actual Ableton/audio interface/physical kit validation remains a clearly labelled human check, not claimed from synthetic tests.

## Out of Scope

GPU/GLSL/WebGPU, renderer rewrite, arbitrary field-code editor, simulation feedback textures, beat/onset/pitch/instrument inference, audio recording/playback, driver installation, Ableton Link, MIDI file playback, automatic audio routing, changes to the other agent's CAD/model work, and OTA publication.

## Further Notes

The user confirmed these seams in-session. Defaults, feature-band cutoffs and timeout values are engineering assumptions, not additional user requirements. Keep implementation lightweight but real: normal persisted authoring and real output, not screenshot-only functionality. Every implementation lands via PR; do not publish a desktop release without explicit approval. Workers use fresh Claude Fable/low sessions in twux; at most two concurrently. Only task-owned resources may be stopped/removed.
