# Kit preview / Stage

`Pixels` remains the default, with unchanged RGB interpretation and arc geometry. Stage is
view-only: it never changes the model, frame, poses, output or authored settings. The source
references are the user's `raised-rim-v1-beauty.png` and `photos/IMG_2147.jpeg` under
`docs/cad/drum-kit/.cache/`: clear acrylic, strips inside, pale heads, actual chrome hardware.
CAD/photos are read-only references, not runtime dependencies.

## Export contract

- Stage alone requests `/models/acrylic-kit/kit.manifest.json` and `/models/acrylic-kit/kit.glb`.
  `GLTFLoader` is dynamically imported on that path. No decoder, remote texture or dependency.
- Manifest v1: `version`, `source.{path,sha256}`, `units:'metres'`, `axes:'gltf-y-up'`, and
  `drums[]` with `id,cadId,rootName,radiusMm,hoopSpacingMm,hoopPixelCounts`. Four hoops per drum.
  Source SHA is provenance, not a browser-side hash of the original Blender file.
- Named root `kit:<id>` has `userData.stageDrumId`; GLTFLoader sanitizes colons, so extras and
  `userData.name` also resolve it. Each root's **local** coordinates are centred at the midpoint
  of the reference hoop stack, axes `(CAD X, CAD Z, -CAD Y)`, distances metres.
- The web replaces root placement with the authored rigid body pose, never the CAD arrangement.
  **All child node transforms and source geometry are retained.** Mesh positions are transformed
  into that root's coordinates before cylindrical LED sampling.
- Every mesh needs `stageRole`: `acrylic`, `head`, `metal`, `gasket`, `pcb`, `diffuser-body`,
  `led-lens`, or `led-tape`. Lit roles also need `stageHoop` (numeric 1–4, first→last body hoop).
  Every hoop needs a lit mesh. Placeholders/source vertex colors are not used for appearance.
  No camera, light, floor, or stand is part of this asset contract.

## Compatibility and live RGB

Optional `SerializedDrum.stage` is the shared serializer's physical frame, independent of LED
start angle, local spin and reverse. glTF→scene matrix columns are converted `xAxis`, `zAxis`,
`-yAxis` × `1000/SCENE_SCALE` (10); translation is world `(x,z,y)/SCENE_SCALE` (100 mm/unit).
Mirrors may produce negative determinants; no quaternion reconstruction removes that reflection.

Match ID, radius and hoop spacing within **0.05 mm**, and exactly four hoops. Pixel density may
change without changing the real body: each hoop uses its own authoritative prefix count.
Changed dimensions, absent/invalid metadata, unknown drums, invalid role coverage and bounded
atlas overflow retain diagnostic Pixels with an explicit reason. Matching drums remove Pixels'
triangles, preventing doubled thick LED bands. Loading/error retain the whole Pixels kit.

One bounded preallocated RGBA DataTexture has one row per matching hoop (max 2048×128, 1 MiB).
The shader samples nearest, centred pixels with wrap using `atan(-body.z,body.x)`. Phase comes
from each hoop's first normal dotted with physical body X/Y; direction comes from its next normal.
One/two pixels are direction-invariant. Null, zero and short frames clear stale colors and padding.
Raw RGB bytes have the same linear `/255` interpretation as Pixels, not a source-color bake.

## Appearance and ownership

Eco: low-opacity standard-material acrylic, DPR 1, no transmission pass. Detail: physical
transmission, IOR 1.49, 5 mm local wall thickness, DPR 1.5. Actual shell geometry is unchanged.
Chrome reflects a Stage-only Three RoomEnvironment, generated once and never shown as geometry.
Pale heads and acrylic are **not** uniformly emissive. No invented shells/stands, glow, average
spill, shadow maps or postprocess are added. Optical appearance is illustrative, not calibrated
or a claim of Cycles parity; actual GPU cost/appearance needs separate browser inspection.

A Stage mount owns loaded geometry/placeholders and its procedural environment. Model/quality
changes replace only derived node/material/atlas snapshots; frames do not rebuild or reload.
Unmount aborts fetch, disposes late parse results, and retires all owners. Failures can be retried
by reopening Stage; there is no automatic retry loop. Pixels never allocates these optics.

## Focused verification (no WebGL fidelity claim)

Run from `apps/web`:

```sh
pnpm exec vitest run src/lib/visualizer src/lib/app/docks/Visualizer.test.ts
```

Tests use real core/shared serialized models and tiny role-tagged fixture meshes. They check
mirrored/flipped/reversed/phased pixel addresses and actual atlas bytes/zeroes, transforms and
no stretching, shader uniforms, explicit fallbacks, load/error/late-result lifetime, resource
ownership and unchanged diagnostic controls. Ordinary CI also CPU-parses the actual bundled GLB
and binds it to all four defaults; exporter/geometry checks are in `scripts/preview-kit/`.
UI changes still require real-app `pnpm ui-shot` captures and `docs/design-system.html` regeneration.
