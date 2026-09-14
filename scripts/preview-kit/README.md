# Acrylic Stage asset

The Stage kit comes from Trent's supplied Blender model, **not reconstructed drum cylinders**.
Its source and the real-kit photos stay under the user-owned, untracked `docs/cad/` cache.
The app bundles only the reduced derivative in `apps/web/public/models/acrylic-kit/`.
Blender is an **authoring/export tool only**, never an app/runtime dependency.

## Provenance and boundaries

- Master: `docs/cad/drum-kit/.cache/blender/realism/raised-rim-v1.blend`.
- SHA-256: `8715c5423ff8efe96966d7a448f617888034fd1f149c7ac2d7ee84a84b22acbc`.
- Visual references: the adjacent `raised-rim-v1-beauty.png`, external inspection and section;
  `docs/cad/drum-kit/.cache/photos/IMG_2147.jpeg`, `IMG_2150.jpeg`, and `photos3/` hardware photos.
- Trent approved headless export and the default LED-dimension correction on 2026-09-14.
  Source profiles retain photo-informed assumptions (including rim rise), not fabrication or
  physical-clearance certification. Browser lighting is illustrative, not Cycles equivalence.
- No photos, original packed RGB, lookdev textures, lights, camera, stage floor or invented stands
  are bundled. Acrylic is not uniformly emissive. Runtime strip colors come from the engine frame.

The inspected master has **2,127 meshes**, of which **1,203** are render-visible, with
**3,291,624 base vertices**. The single studio floor is omitted. Export consolidates the actual
remaining evaluated geometry by drum/material/hoop, reducing detail with Blender's Decimate
modifier. The shipped derivative is **68 meshes / 286,416 triangles / 16,330,624 bytes**.
Detailed source counts, derivative counts and hashes are in
[`docs/reports/2026-09-14-stage-asset-export.json`](../../docs/reports/2026-09-14-stage-asset-export.json).
These are asset sizes—not frame-rate or live-machine measurements.

## Re-export (explicit author operation)

Requires an already-installed **Blender 4.5+** and the exact original cache files. CI does not
need or install Blender. If the source is absent, obtain it from its owner; do not download a
substitute or regenerate a different kit under the same provenance.

```sh
BLENDER='/path/to/Blender'
OMP_NUM_THREADS=2 "$BLENDER" --background --factory-startup --disable-autoexec \
  --threads 2 --python-exit-code 1 \
  docs/cad/drum-kit/.cache/blender/realism/raised-rim-v1.blend \
  --python scripts/preview-kit/export-blender.py -- \
  --out apps/web/public/models/acrylic-kit/kit.glb \
  --layout docs/cad/drum-kit/.cache/lighting/cad-led-layout.json \
  --report docs/reports/2026-09-14-stage-asset-export.json
node --test scripts/preview-kit/asset.test.mjs
pnpm --filter @ledrums/web exec vitest run src/lib/visualizer/stage-export.test.ts --maxWorkers=1 --minWorkers=1
```

The first browser check caught a source-material ambiguity: the thin drumhead envelopes share
`Onshape/shell-acrylic` with the shells. Export now classifies these by physical purpose into
`head`, alongside the woven wrap. A projected-area regression ensures each head includes its
actual membrane—not merely the rim wrap. No replacement disc is generated.

The command runs no render and never saves the source. It disables scene Python auto-execution,
checks the source hash before and after, and refuses unknown role/material groups. The derivative
has hard **320,000-triangle / 20 MiB** ceilings. Export is not byte-reproducible across Blender
versions; after an intentional regeneration, inspect the result and retain its new report/hash.

## Runtime contract

`kit.manifest.json` is version 1. Each of four drum roots has `stageDrumId`; meshes carry
`stageRole` and, for the body/lens/tape of a strip, a **1-based `stageHoop`**. All child transforms
are identity. The mesh vertices are glTF Y-up **metres**, centred at the middle of that drum's
LED hoop stack: glTF `(x,y,z)` = CAD-local `(x,z,-y)`.

The browser maps each root rigidly to the configured physical drum pose. Its final scene uses
`(worldX,worldZ,worldY)/100`, an axis reflection which must not be mistaken for a rotation.
No asset scaling substitutes for mismatched LED dimensions. Optional serialized drum pose and
hoop metadata supports the new renderer; absent/incompatible data retains diagnostic Pixels.
The default kit dimensions now match the asset, while IDs, counts, old centres/rotations and
wiring are preserved. See [`docs/default-kit-dimensions.md`](../../docs/default-kit-dimensions.md).

CI's built-in-Node checks parse the actual GLB: pin/budgets/self-containment and role/axis/hoop
geometry (including shells **outside** the tape). The web Vitest suite checks canonical dimensions,
strip identity and actual rigid binding/camera bounds through its declared core dependency;
there is no cross-workspace TypeScript-loader borrowing. Neither requires Blender or a browser.
GPU appearance/disposal and live colors need separate headless app checks.

## Opt-in real GPU contract check

Against an **already running, operator-owned disposable Vite + voice-server stack**, with output
explicitly disabled, a non-default OSC port, tunnel off and no other clients:

```sh
pnpm verify:stage-gpu -- http://127.0.0.1:5294
```

The script starts only headless installed Chrome, never Blender/Live/Max or a server. It refuses
non-literal/default/ambiguous URLs, rejects server mutations (including takeover), requires a
sole editor/client and disabled live/persisted output, supplies empty synthetic WebMIDI ports,
and blocks media/audio-device requests. URL/protocol checks cannot prove disposable storage:
operator setup remains necessary. A hard 120 s browser-kill deadline bounds an unresponsive page.
Do not run alongside benchmarks or another capture/client. It requires a dev Vite surface for
loading the actual source modules; this is not a packaged-desktop delivery test.

The real bundled GLB, production binding/material/atlas and GPU readback exercise **1,280**
colored/zero/missing/truncated-frame samples across Eco/Detail, phase/reverse/flip/X-Y mirrors,
and heterogeneous strip counts. Readback uses a linear offscreen target and isolates tape
surfaces: it checks raw RGB addressing, **not whole-scene optical calibration**. A deliberately
invalid manifest then verifies the visible in-app Pixels fallback. No authored kit is changed.
Results and the fallback screenshot go under `.ui-shots/`.

The source has an **8 mm tangential seam at CAD 90°** (`seamGap` / `seamAngle` in the supplied
`.cache/v4-current-features.json`, independently confirmed by actual GLB ray intersections).
At that real gap a camera can see the opposite strip. The test checks that visible surface's
nearest logical pixel and samples both sides of the seam; it does not manufacture a surface
or alter the saved pixel phase. The source cache is provenance, not a test-runtime dependency.

This check caught a GPU-only wrap defect: reciprocal-based GLSL `mod(count,count)` can return
`count`, sampling a short atlas row's black padding. The shader now wraps its bounded rounded
index with an explicit comparison. JavaScript-only angular/atlas tests cannot certify that GPU
behavior; keep both the ordinary shader guard test and this opt-in readback check.
