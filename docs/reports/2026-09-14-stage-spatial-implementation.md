# Stage / Spatial Field / track inputs — implementation evidence

Date: 2026-09-14. Source: Trent's approved four-workstream build, then his explicit request to
use the actual clear-acrylic Blender kit and match its dimensions. Work is on
[PR #218](https://github.com/twadams21/LEDrums/pull/218); **not released or deployed**. Local
verification is complete; the PR records ordinary clean-checkout CI and delivery status.
The measured default-path and GPU wrap regressions are corrected. This report does not assert
user visual acceptance.

## Actual kit, not surrogate shells

The browser uses a separate derivative of
`docs/cad/drum-kit/.cache/blender/realism/raised-rim-v1.blend`, plus live engine RGB. Headless
Blender 4.5.13 LTS was explicitly authorized; no GUI, render or source save occurred. The master
SHA stayed `8715c5423ff8efe96966d7a448f617888034fd1f149c7ac2d7ee84a84b22acbc`.

- Bundled: **68 meshes, 286,416 triangles, 16,330,624 bytes**, under 320k / 20 MiB ceilings.
- No original photographs, textures, animations, studio floor, lights, camera or baked RGB.
  Shells/hardware are reduced actual geometry; no invented stands or replacement drum bodies.
- The first browser pass caught an export ambiguity: the real thin head envelopes share the
  shell's Blender material. Physical-role classification now includes the envelopes in `head`,
  not just the woven rim wrap. A real-GLB projected-area regression detects the original error.
- Acrylic/head surfaces are not uniformly emissive. Each internal strip samples the authoritative
  frame through a bounded reusable RGBA texture. Null/short/zero frames clear stale color.
- Eco uses low-opacity acrylic at DPR 1. Detail uses transmission at DPR 1.5. These are
  illustrative browser materials, **not Cycles equivalence or optical calibration**.
- Camera fitting uses projected box extents, with actual GLB hardware-framing tests across all
  four presets and narrow/wide aspects. Camera, quality and presentation never change the kit.

[Exporter, provenance and regeneration](../../scripts/preview-kit/README.md) ·
[export inventory/hash](2026-09-14-stage-asset-export.json) ·
[runtime ownership/binding contract](../../apps/web/src/lib/visualizer/README.md).

## Dimensions versus pose and output

[Canonical defaults](../default-kit-dimensions.md) use recorded **tape-centre** diameters and hoop
spacing, not outside acrylic diameters. `tom2` is the CAD `floor-tom`. There are still **2,192**
pixels, with literal counts/order/IDs/reverse/spin and DMX mapping preserved. Old post-migration
world centres/rotations remain; the complete Blender arrangement was **not** adopted. Existing
saved projects are not rewritten. Correcting XYZ intentionally changes spatial sampling; that
must not be confused with the view-only Stage optics.

A pure protocol serializer now serves both server and offline web. Optional `drum.stage` carries
world-mm midpoint, physical axes, radius/spacing and per-hoop counts, independent of angular
phase/reverse and respecting flip/mirror. The asset is rigidly placed, never stretched to hide a
mismatch. Missing/incompatible geometry remains diagnostic Pixels with a reason. Pixels is still
the default, and its cold path does not request the model or GLTFLoader.

## Actual browser checks

Final checks used disposable storage, non-default loopback URLs/ports and disabled output.
The repeat batch and strict captures supplied empty synthetic WebMIDI ports and blocked media
capture/audio contexts; the app's startup MIDI probe never reached real ports. The guarded
batch watched the actual proxied engine WS, required one editor/client, refused `setOutput` /
`setProject`, and verified kit geometry was unchanged. Graph/source authoring affected only the
disposable storage.

| Check | Evidence |
| --- | --- |
| Real geometry and live RGB | Strict `pnpm ui-shot`: `.ui-shots/acrylic-stage-live.png`; live 2D map alongside sourced Stage |
| Four cameras/reset, Eco/Detail, reduced motion | `.ui-shots/acrylic-detail-reduced-motion.png`; no console/page errors |
| Three warm Stage↔Pixels cycles | Identical WebGL handle counts across cycles; Stage 199 buffers / 7 textures / 12 programs, Pixels 7 / 5 / 3 on the active context |
| Actual 3D/2D remounts and narrow authoring | `.ui-shots/acrylic-authoring-narrow.png`; no console/page errors |
| Named Audio selection and return to browser source | `.ui-shots/acrylic-track-source-narrow.png`; server input-map acknowledgement for both choices; no capture started |
| Spatial Field authoring thumbnail | Strict `pnpm ui-shot`: `.ui-shots/spatial-field-authoring-verified.png` |
| Actual GPU pixel mapping and zero/missing/short frames | `pnpm verify:stage-gpu`: **1,280 samples, zero channel error**, both qualities, phase/reverse/flip/mirrors and heterogeneous counts |
| Unavailable asset and incompatible drum | Visible in-app Pixels fallback; mismatched kick omitted while the other three source drums remain matched |

Retained captures: [sourced Stage](assets/2026-09-14-acrylic-stage.png),
[track inputs](assets/2026-09-14-track-inputs.png),
[visible fallback](assets/2026-09-14-stage-fallback.png).
[Guarded UI evidence](data/2026-09-14-stage-ui-check.json).

Handle tracking observes creation/deletion, **not absolute VRAM**, GPU timing or a proof of zero
renderer caches. Fresh contexts also create small renderer-owned defaults. No benchmark ran
alongside captures. Captures use the disposable kit's configured X mirror; authored poses were
not replaced by CAD poses.

The guarded batch initially uncovered a genuine reduced-motion authoring freeze. A bounded
browser reproduction and paused CDP stack traced it to **Spatial Field thumbnail scratch being
deeply proxied by Svelte**, not Stage cleanup. Static drawing subscribed to its own scratch
writes. `EffectThumb` now keeps opaque generator state in `$state.raw`; replacements remain
reactive. A mounted-component regression fails fast on proxy identity before calling the real
renderer, then checks actual drawing, static settling, parameter changes and fire resets.
It went red before the fix and green afterward; the original full switch sequence also passed.
Older canvas-only mount tests returned null from jsdom `getContext`, so they did not reach this
path. Forcibly stopped debug browsers left two half-closed proxy sockets; the safety guard
refused them, and the isolated stack was restarted before the passing batch.

The GPU check caught a second real integration defect: GLSL reciprocal-based `mod(count,count)`
can return `count`, reading a short row's black padding. Explicit bounded index wrapping fixes
both the ordinary shader regression and actual GPU readback. An earlier apparent opposite-side
color was instead the real CAD's **8 mm seam at 90°**, confirmed in source feature metadata and
GLB ray intersections; no invented geometry fills that gap. The test validates the actual
visible opposite surface at those 32 seam samples, plus both adjacent sides. It isolates real
tape geometry to test addressing, not full-scene optical appearance. Reproduce with
[`scripts/preview-kit/README.md`](../../scripts/preview-kit/README.md); raw result:
[`data/2026-09-14-stage-gpu-check.json`](data/2026-09-14-stage-gpu-check.json).

## Named inputs / actual rendered output

The bridge is strict versioned JSON over IPv4 loopback UDP, not OSC wire encoding. Saved IDs,
runtime nonce/peer and monotonic sequence define admission/order; this is collision handling,
not authentication. Registration does not select an Audio source. Press, release and continuous
value paths remain distinct, including Learn behavior and held global controls.

The new-dimension isolated-server proof exercised actual schema → registry → production sink →
voice renderer → binary preview, with output disabled and 2,192 pixels:

| State | Sum of actual preview RGB bytes |
| --- | ---: |
| Active, unmodulated dark voice | 0 |
| Explicitly selected synthetic Audio | 186,530 |
| Stale Audio despite renewed registration | 0 |
| Scoped macro | 236,151 |
| Departure | 0 |

Sums identify that run, not future expected frames. The synthetic CLI connected/departed twice,
including immediate restart before lease expiry could rescue a missing bye. No device was
opened. The sender joins a 250 ms bounded **local send drain**, not a guarantee of UDP receipt.

[Ableton source/device instructions](../../integrations/ableton/README.md) ·
[review corrections](2026-09-14-track-input-review.md) ·
[device/timing review](2026-09-14-device-timing-review.md).

## Measurements — corrected and repeated

The first quiet-host matched benchmark found a regression, not a win. Old frozen renderer versus
first candidate p50 ms/batch on 2,300 identical pixels (80 warmups, 300 alternating AB/BA samples):

| Scenario | Frozen baseline | First candidate |
| --- | ---: | ---: |
| Warm base, one voice | 0.772 | 0.853 |
| Warm active hit, one voice | 1.202 | 1.454 |
| Warm active hits, eight voices | 9.610 | 11.636 |
| Cold hit including state creation | 1.217 | 1.586 |

That result is retained in `data/2026-09-14-spatial-pre-optimization.json`. The neutral zero/one-wave
loop now avoids per-pixel general-dispatch overhead and provably redundant clamps, filling cold
caches during the same traversal. Rich sampling and the per-voice memory budget are unchanged.
Exact Float32 default parity, rich/neutral transitions, and model/source/checkpoint ownership
passed 164 scoped tests.

Three final serial matched runs show **16–20% less warm-render time** and **2.9–6.0% less cold
render time** than the frozen renderer. Parent confirmation p50 ms/batch:

| Scenario | Frozen baseline | Final candidate |
| --- | ---: | ---: |
| Warm base | 1.188 | 0.956 |
| Warm own hit | 1.172 | 0.978 |
| Warm eight voices | 9.474 | 7.881 |
| Cold including state | 1.198 | 1.143 |

Raw pairs: `data/2026-09-14-spatial-optimized-{1,2}.json` and
`data/2026-09-14-spatial-parent-final.json`. Absolute timings varied; compare paired results
within a run, not the first run's absolute timings against a later machine state. The active
age-120ms waves, dt=0, 2,300 pixels, 80 warmups and 300 alternating samples were not weakened.

Both whole-server observations use this feature branch: “before” means the unoptimized candidate,
not stock `main`. The pre-correction isolated server run is retained in
`data/2026-09-14-dev-pre-optimization.json`: 2,192 pixels, eight sustained lanes, observed total
voices 8–16 (release tails), 5 s warmup + 15 s observation. Fourteen non-overlapping timing
windows had render p50 **4.658–8.193 ms** and p95 **8.199–24.308 ms**. Selected-window elapsed
clamping totalled **1,505.136 ms**; backlog-discard total was zero. These are window ranges/totals,
**not averaged run-wide percentiles**. Client preview-arrival gaps were p50 **34.304 ms**, p95
**63.344 ms**, p99 **76.942 ms**, not paint cadence or physical latency.

The repeated whole-server run retained identical kit/input-map/show hashes, effect defaults,
input cadence, eight sustained lanes and 14 non-overlapping timing windows. It observed 8–16
total voices, render p50 **7.076–7.500 ms**, p95 **13.198–16.214 ms**, selected-window elapsed
clamping **764.542 ms**, and zero backlog discard. Preview-arrival gaps were p50 **30.475 ms**,
p95 **58.040 ms**, p99 **70.379 ms**. Raw result:
`data/2026-09-14-dev-post-optimization.json`.

The heavy eight-lane workload **still exceeds this older host's budget at times**. Maximum
observed tick duration was **38.491 ms**, versus **34.734 ms** before; not every tail improved.
These short operational runs are observations, not a claim that the engine sustains 120 Hz or
that all run-to-run differences are caused by the optimization. The paired microbenchmark is
the controlled renderer comparison.

Host: older Intel i9-9880H Mac, darwin 24.6.0, x64, Node 25.8.2. It is **not the live rig**;
no proportional live-machine prediction follows. The frozen-reference microbenchmark measures
renderer work, not the whole compositor/checkpoint/output/preview pipeline.
[Full measurement definitions and limits](2026-09-14-performance-method.md).

## Integrated verification

- `pnpm typecheck`: all workspaces, zero Svelte diagnostics.
- `pnpm test`: **5,304 workspace tests passed / 7 skipped**, plus **114 Node tests**, before
  relocating one canonical-asset assertion out of the root Node test into web Vitest.
- After that test-only relocation: both actual-GLB web tests and all **113 Node integration
  tests** passed, alongside repeated whole-workspace typecheck. The check no longer borrows
  the server's `tsx` dependency; no warning suppression, dependency or lockfile change.
- Real seeded dead-source detection and clean task-source scan passed with a temporary
  `docs/cad/**` exclusion. The final **ordinary** local dead-code command still fails solely
  because it sees user-owned untracked
  `docs/cad/drum-kit/.cache/lighting/layered-before-phase-match/source-capture.mjs` alongside
  its deliberate probe. Those files and repository CAD ignores were not changed.
- `pnpm build` and `pnpm design-system` passed; generated styleguide is **1,344,226 bytes** with
  Stage and named-input entries. Final master Blender SHA-256 remains unchanged.
- Independent late-correction source review: no must-fix findings. Runtime source did not change
  after the guarded UI/GPU runs; subsequent changes were test typing/placement and documentation.

## Remaining boundaries

- Packaged desktop webview asset delivery remains unverified. GPU addressing/readback is not
  optical calibration or absolute VRAM verification.
- Ordinary clean-checkout CI and delivery status are tracked on PR #218; the local CAD-only
  obstruction is reported separately, not called a passing ordinary gate.
- Original CAD/cache/photos remain read-only and untracked references, not cleanup targets.
- Ableton/Max host loading, `.amxd` packaging, pass-through/DSP fidelity, saved persistence and
  automation are unverified. Names are manually editable, not Live-API track-name observers.
- No controllers, actual MIDI/audio capture, physical lighting output or stick-to-light latency
  verification. No Unreal installation/migration. No release or deployment.
