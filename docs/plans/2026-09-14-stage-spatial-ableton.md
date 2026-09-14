# Stage, spatial fields, performance and Ableton inputs

Status: sourced Stage, GPU readback, measured default-path correction and local verification complete. Delivery/ordinary CI: [PR #218](https://github.com/twadams21/LEDrums/pull/218). No release.

## Requirements and provenance

Trent approved building these four workstreams in the current session on Trent’s MacBook Pro (identity checked with `scutil --get ComputerName`): realistic stage preview; richer XYZ effects related to Spatial Field; measured throughput/latency/frame consistency; and drop-on-track Ableton MIDI/audio devices that auto-register named inputs, with effect automation as an extension to explore.

Trent explicitly prohibited opening Ableton, Unreal, Max or other desktop software to test. Verification uses the LEDrums development server, synthetic senders and headless captures of that server only. No microphone/device access, physical output, controller tests, production project data, releases or external deployments. This is an older/slower development Mac, not the live Mac; measurements apply to this host, and relative GPU/CPU gains are not assumed to transfer unchanged.

## Stage reference correction — Trent, 2026-09-14

Trent interrupted final verification to reject the current opaque shell/stand approximation:
"They're clear acrylic drums with the LED strips on the inside of the drum"; he prefers the
actual Blender model as the most accurate Stage kit. This supersedes the agent-selected generic
body/support styling; it is not permission to change lighting coordinates or real output.

Reviewed reference assets (all below `docs/cad/drum-kit/.cache/`):
- `blender/realism/raised-rim-v1-beauty.png`, external inspection and labeled section: current
  raised-rim scene, clear shells, internal diffuser bands, real chrome rims/lugs and heads.
- `photos/IMG_2147.jpeg`, `IMG_2150.jpeg`, `IMG_2151-preview.png` and the whole-kit photo;
  `photos3/photo-1.jpeg` / `photo-2.jpeg`: physical acrylic, internal bands and hardware.
- Preferred source: `blender/realism/raised-rim-v1.blend` (251,527,855 bytes). No existing
  GLB/GLTF export was found. It needs a bounded browser derivative, not inclusion of the raw
  scene or a Blender runtime dependency. The derivative and runtime binding are now implemented.

Required direction: use the actual kit geometry where feasible, no invented stands, transparent
acrylic with light inside rather than emissive opaque shells, and live authoritative RGB rather
than baked look colors. Preserve default Pixels and keep preview resources out of core/output.
The source scene and photo library remain untouched. Trent explicitly approved **headless
Blender export only** (no GUI/render/source save), then requested the app kit match Blender's
dimensions. Canonical defaults now use the recorded tape-centre diameters and ring spacing;
old post-migration centres/rotations, IDs, counts and wiring stay intact. Existing saved kits
are not silently rewritten. This dimensional change intentionally changes world XYZ (and thus
spatial sampling), unlike the view-only model/material work.

Approved export completed with Blender 4.5.13 LTS: **68 meshes, 286,416 triangles, 16,330,624
bytes**, no images/baked look or original studio objects. Source hash verified unchanged.
`apps/web/public/models/acrylic-kit/` is the separate derivative, with reproducible exporter and
CI asset checks under `scripts/preview-kit/`. Rigid per-drum placement follows app poses;
incompatible geometry falls back to Pixels rather than stretching the accurate model.
Old Stage screenshots/review establish only the old implementation, not acceptance of this direction.
The first sourced-model browser pass found the shared shell/head material had made membranes
nearly invisible in Eco; semantic head classification plus an actual-GLB surface-area regression
fixed it. Camera fitting now uses perspective-projected box extents (actual-asset tests across
four presets/narrow-to-wide aspects), not a loose max-side sphere. New strict captures verify
sourced geometry and live field RGB. The guarded Detail/camera/remount/narrow/source-selection
batch passes with stable WebGL handle counts and unchanged kit geometry. It exposed a Svelte
thumbnail feedback loop; opaque `$state.raw` generator scratch fixes the fast mounted regression
and original browser reproduction. GPU readback now passes 1,280 exact RGB samples, including
transforms/heterogeneous counts/zero/short frames; bounded wrapping fixes an actual shader-padding
edge case. Final captures block real devices. Detailed evidence and measured results:
`../reports/2026-09-14-stage-spatial-implementation.md`.

## Implementation choices (not separately user-locked requirements)

1. Preserve the CPU lighting engine and cheap faithful preview. Add opt-in Three.js Stage with stable camera presets and illustrative optics (direct per-pixel strip color, not calibrated spill). **The original generic shells/stands are superseded by the sourced correction above.** No photometric-calibration claim.
2. Extend Spatial Field with bounded authored spatial distortion, preserving default output and per-voice hit semantics. Cache geometry/scratch correctly and prove parity. No GPU dependency yet.
3. Add bounded host-side timing observations and an opt-in dev-server stress driver. Separate actual engine tick duration/intervals from preview network arrival. Do not label software measurements physical stick-to-light latency. Compare only matched quiet-host runs.
4. Build a loopback-only named track-input bridge, bounded and schema-validated, without granting external devices editor/file/system capabilities. MIDI uses existing input routing; per-track OSC addresses permit independent source selection. Audio supplies the existing normalized four-feature contract; one explicitly selected track owns the existing Audio nodes, and per-track OSC bands remain independently mappable. Browser capture remains the default. Max for Live device sources are to be checked structurally and via a simulated sender only; a distributable device is not declared Ableton-verified without Live/Max.

## Integration seams

- Stage: web visualizer only; consumes authoritative model/RGB, never recomputes hardware output.
- Spatial Field: pure core generator and engine-owned state; no Node, browser or network imports.
- Frame timing: server host observer, bounded retention and snapshot quantiles, optional protocol stats extension.
- Track input: versioned protocol → loopback IO adapter → registry/lifetime/routing → existing voice-host input seam. Registry snapshots feed Settings. Input identities never claim editor presence.
- Possible later Unreal adapter: external read-only consumer of geometry + frames. No mandatory engine integration or new runtime is justified before a useful measured prototype.

## Safety and ownership

Existing untracked `docs/cad/` is now an explicitly requested visual/model reference, not expendable task scratch. Inspect it read-only; preserve all originals. Any approved browser export goes to a separate, task-owned asset path. Work uses the existing checkout rather than another dependency installation because the volume has little free space. Agents have disjoint source ownership; the integrating session alone runs full gates, long benchmarks, dev-server captures, styleguide regeneration and delivery.

## Verification gates

- Pure-core determinism, finite output, default parity, geometry and state lifetime regressions.
- Track registration/restart/duplicate identity/stale audio/stuck note cleanup, malformed packets and bounded ingress tests.
- Server-only synthetic MIDI/audio → existing render pipeline → nonzero RGB and expiry-to-zero at a controlled modulation fixture.
- Headless `pnpm ui-shot --strict` of Stage controls/presentation and registered track inputs on isolated ports with output disabled.
- Serial workspace typecheck/tests/dead-code/build, regenerated design system, independent review, PR and green CI. No OTA release without a separate explicit publish approval.

## Measurement feedback

The first quiet-host 2,300-pixel equivalent-work benchmark found a ~20% warm-hit default-path
regression. A specialized neutral traversal and fused cold-cache fill corrected it; three final
matched runs show 16–20% less warm and 2.9–6.0% less cold render time versus the frozen renderer.
The workload/reference were not weakened. Before/after data and parent confirmation are retained.
The repeated whole-server stress used identical kit/input-map/show hashes; it still exceeds this
older host's budget at times. No sustained-120-Hz, uniformly improved tail or physical latency
claim follows. All benchmarks ran without other task-owned tests/servers/browsers competing.
Workspace tests/typecheck, targeted/integration checks after a test-only relocation, seeded task-source
scan, production build and design-system regeneration pass. Ordinary local dead-code still sees
user-owned CAD scratch; clean-checkout CI remains required. Richer opt-in rendering is not
substituted for the baseline.

## Not established by this build

Real Ableton/Max loading, pass-through fidelity, live set restoration and automation; calibrated spill/brightness; physical kit latency; live-Mac performance; Unreal/Niagara or GPU readback performance. These remain explicit follow-up validations rather than inferred capability claims.
