# 3D kit preview: arc-segment LEDs (continuous, no gaps) — not wedges/box-tubes

You (fix-3drot) already fixed the Scene camera; now fix the LED geometry. Branch
**`feat/unified-shell`**. Report to parent (`--session parent`). No push/PR/merge.

## Goal
LED segments in the 3D kit preview must be proper **arc segments** — annular sectors that follow the
hoop's curvature — so consecutive segments tile the ring **continuously with NO gaps** (continuous
light). The user's reference image: a hoop is a ring band (inner→outer radius); each LED is a curved
slice of that band subtending its arc; neighbours share edges so the lit ring is unbroken.

## Current state (the bug)
`apps/web/src/lib/visualizer/Pixels.svelte` renders an `InstancedMesh` of `BoxGeometry(1,1,1)` scaled +
oriented per pixel into straight "tube segments", with a `FILL` fraction trying to make neighbours meet.
Straight chords on a curved hoop don't follow the ring and leave gaps at the joins. Replace this with
true arc geometry.

## Recommended approach (refine as you see fit — prioritise no-gaps + correct curvature + perf)
The model emits pixels grouped **drum → hoop → angular index**, so consecutive indices within a hoop are
adjacent around the ring (`model.positions/tangents/normals/segmentLengths`, `model.drums[]` with
`pixelStart/pixelCount`). Build the lit ring as continuous arc geometry from the ordered hoop pixels:
- For each pixel, build a curved arc-segment ribbon spanning **midpoint(prev,i) → i → midpoint(i,next)**
  at the hoop band width, so adjacent segments share an edge → zero gap. Curve it along the ring (use
  the neighbouring positions / a short Catmull-Rom, or reconstruct the arc from position+tangent+normal
  + radius-of-curvature).
- **Detect hoop boundaries** so you never bridge the last pixel of one hoop to the first of the next:
  a robust, data-only test is a position jump `> k × segmentLength` between consecutive indices (the
  `SerializedModel` does not carry hoopCount; you may also derive `pixelsPerHoop = pixelCount/hoopCount`
  using `@ledrums/core` `DEFAULT_KIT` hoopCount, but the geometric test also works for the live server
  kit). Flag whatever you choose.
- Implementation: a single (or per-drum) **merged `BufferGeometry`** built on model change (cold path)
  with a **per-vertex color attribute updated each frame** (`needsUpdate`) from the frame buffer — keeps
  it gap-free + curved + per-pixel colored, geometry static / colors dynamic. (Per-drum instanced curved
  arcs are an option only if the arc angle is uniform within a drum.)
- Keep the unlit segments reading as a frosted/dark band (as today), and keep the per-frame color path.

## Preserve
- Your camera-framing fix (commit 67076be) — do NOT reintroduce camera resets on pad hits.
- Per-frame color updates must stay on the hot path (no full geometry rebuild per frame — only colors).
- Perf: the real kit is ~2300 px (density 120); the lab ~584. Make geometry build cold + colors hot;
  flag perf characteristics + any tuning path.

## Boundaries + gate
Edit ONLY `apps/web/src/lib/visualizer/Pixels.svelte` (+ `Scene.svelte` if strictly needed). Do NOT
touch `packages/core/**`, `apps/web/src/lib/app/**`, `store.svelte.ts`, or `trigger-lab/{fixtures,render,
sim}.ts` (sibling agents own those). A sibling is mid-edit in `packages/core` (voice bridge) so the
FULL typecheck is transiently RED in core — gate with `pnpm --filter @ledrums/web typecheck` (your files
clean) + note any core errors are the sibling. Run the Svelte MCP autofixer on Pixels.svelte.

## Verify + report
Visual check on the running :5173 stack (rotate the 3D preview — segments form continuous lit rings, no
gaps; lit colors still update on hits; camera doesn't reset). A headless 3D assertion is impractical
(you used a CDP probe before — reuse if helpful, keep it in scratch, don't commit it). Then:
```
twux send-message --session parent --slice-status "<short>" --body "<the arc-segment construction, hoop-boundary handling, geometry-cold/colors-hot split, perf flags, how verified, pasted web typecheck>"
```
