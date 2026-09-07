# F1 — Spatial Field implementation

You are the Fable/low implementer of the CPU Spatial Field effect for GH #214. Read SPEC.md in this directory. Work only in your assigned worktree, branch feat/spatial-field. Base is fresh origin/main fec83bee. Another worker owns audio graph/protocol/UI. Parent is a Pi session (native SendMessage may not reach it): write your complete completion report to this directory/FIELD-RESULT.md, commit it, and go idle. Parent polls git/twux. Do not launch agents, run dev servers, full test suites, publish, push, merge, update shared .mex docs or modify the CAD agent's worktree.

## Deliverable

One normal EffectGenerator id `spatial-field`, name `Spatial Field`, category `texture`, world-space continuous twisting luminous field plus a hit-centred distortion/ripple. Existing effect gallery/normal controls, scoping, Mix, modifiers and envelopes must work. This is CPU only, no custom editor or new render path. Defaults should visibly read on four sparse hoops and the normal thumbnail. Absolute animation for the base, explicit age for per-voice hit perturbation. Keep existing voice semantics: the bridge gives a voice-local synthetic trigger, not all live global input. Looped field gives continuous motion; one-shot layered voices each carry their own hit. Do not claim loops receive every later drum hit unless existing architecture actually supplies it.

## Relevant code

- packages/core/src/effects/types.ts (current main has voiceLife/timebase)
- packages/core/src/effects/impl/ripple-3d.ts: emission lifecycle, effectOriginWorld, color/life handling
- packages/core/src/effects/emitter.ts, life-fade.ts
- packages/core/src/effects/registry.ts, metadata.ts, vocabulary.ts and effect tests
- packages/core/src/voice/generator-bridge.ts (inspect clock semantics before choosing timebase)
- packages/core/src/geometry/pixel-model.ts (Z is up; units mm)
- .mex/patterns/add-an-effect.md

## Shape and decisions

1. World field: normalize XYZ around kit bounds centre by a stable kit scale (guard zero-size kit); twist XY about vertical Z as a function of Z; combine smooth periodic/small bounded harmonic functions for a flowing luminous band field. No expensive raymarch/noise libraries. O(pixels * bounded small terms). Different positions sample one continuous field, independent of drum identity/camera. Effect scale/twist may modulate per frame; no stale cache tied to params.
2. Hit perturbation: expanding spherical wave at source drum effectOriginWorld, finite width/decay, velocity scales strength; engine-owned emitter cap or direct bounded trigger evaluation. Apply to field coordinates/phase and/or luminosity for an actual visible ripple, not just global brightness. Source unknown should gracefully retain base field.
3. Parameters: standard hue/saturation/brightness plus scale (unitless kit-relative), twist, speed (cycles/s, finite bounded), disturbance (0..1 or clearly bounded), waveSpeed (kit spans/s or mm/s labelled), waveWidth, lifeMs if the emission uses a cutoff. Around 10 controls max. Reuse existing naming and conventions; optional hue spread only if it improves default look. All defaults valid, finite output [0,1], no unseeded random/global clock.
4. Registry and metadata: add effect with discoverable world/spatial tags from existing vocabulary; generic palette entry needs no custom UI. Do not touch audio/modulation/protocol/transport files. If normal registry metadata requires fixture changes, keep them narrow.
5. Tests: default visible; exact repeatability same context/state, time changes image, translated source produces spatially different perturbation, velocity 0 vs 1 differs, no unknown-source throw, parameter extremes finite, model replacement safe. Add engine-level scope/one-shot-life test if useful via existing generator bridge seam. Existing effect sweep must pass.

## Verification/resources

Only targeted core vitest commands, max 2 workers. No full pnpm test/typecheck concurrent with peer. Parent runs integrated typecheck/sweep, UI shot and design-system generation. No browser/server of your own. Install with pnpm install --frozen-lockfile only if node_modules absent; no dependency changes expected. Commit implementation plus report. Report exact SHA, files, tests, default appearance, limitations and deviation from plan. Then idle; parent will kill your twux window when no follow-up remains.
