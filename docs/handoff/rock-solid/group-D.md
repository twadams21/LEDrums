# Group D — Layout & kit geometry (issue #49, lane 4)

Lane-4 orch group report. Branch: `group/D` (off `rock-solid` @ `d0a6e3c`; head `1464e9f`). Context:
[doc 08](../../plans/2026-07-02-rock-solid/08-layout-splitter-kit-flips.md).

## Slices

- **S09 — Right-dock resize rail** — **DONE BY PRIOR WORK (skipped, no impl).** The Phase-2 shell rework
  already ships exactly S09's capability: `AuthorShell.svelte` has a horizontal `Splitter` on the
  visualiser↔buses boundary in the right column (`VIZ = {key:'authorVizH', def:280, min:180, max:620}`;
  `vizH` reads persisted `paneSizes[VIZ.key]`; `setPane` writes; `paneSizes` is serialized (store :981) +
  rehydrated (:1009)). Acceptance (persisted right-dock resize rail within clamps; no regression to the
  other rails) is met by existing code. Reconciled per the lane's Phase-2 reconciliation directive.
- **S10 — Per-drum flip (+ pixelsPerHoop fix)** (`slice/S10` @ e26db25, impl `S10-drum-flip`, opus/high):
  `flip?: boolean` on `drumSchema`; in `buildPixelModel` a proper `(x,-y,-z)` 180° rotation (negate `localZ`
  + negate the angular sweep before start/spin) — its own inverse; hoop/pixel index order + DMX bytes
  untouched. Plumbed inspector toggle → `setDrumTransform` → `setKitTransform` → both engine hosts. Fixed
  the latent `pixelsPerHoop` drop on the legacy path (input-router + `engine.setKitTransform` `Pick`).
- **S11 — Kit mirror X/Y** (`slice/S11` @ 1464e9f, impl `S11-kit-mirror`, opus/medium): kit-global
  `mirror: none|x|y` on `kitGlobalSchema`, applied as a FINAL world-space reflection in `buildPixelModel`
  (world + tangent + normal + drum effect origin), composing on top of S10's flip; DMX byte-invariant. New
  kit-global `setKitGlobal` message (NOT the per-drum carrier) reaches both hosts → `reloadKit`. Mirror
  `SegmentedControl` on the Patch view toolbar; live + persisted.

## Merges

- S10 → group/D fast-forward. S11 → group/D fast-forward. S11 branched atop S10, so its green sweep tested
  the **combined** tree (no separate integration merge; no redundant re-sweep). `rock-solid` already an
  ancestor of group/D (nothing to merge in).
- Integrated sweep (from S11, = current group/D tree): **typecheck 0** · **all green, 0 skips** — core 560 ·
  server 212 · web 1107 · io 13 · protocol 1.

## Group review (full diff vs doc 08 + slice files + AGENTS.md)

Verdict: **PASS, no findings requiring fixes.**

- **Core purity verified on BOTH geometry slices** — no IO/DOM/Node imports added to `packages/core`
  (checked the group diff directly). The flip/mirror math lives in pure `pixel-model.ts`/`kit-schema.ts`.
- **Geometry-only invariant enforced by goldens** — `flip.test.ts` + `mirror.test.ts` assert `dmxMap`
  (`perPixel` + `universes`) byte-identical regardless of flip/mirror, involution (double = identity), and a
  `mirror ∘ flip` compose case. A flip/mirror never re-patches hardware.
- **Latent `pixelsPerHoop` bug fixed** on both engine paths, regression-tested (`kit-transform-forwarding.test.ts`).
- **Live smoke-load (my independent run):** `LEDRUMS_ENGINE=voice pnpm ui-shot patch-graph --strict` — Patch
  view renders with the new MIRROR control + full routing tree, **clean console, no effect loops / throws**.

## Deviations accepted

- S10: implemented the doc's authoritative "negate `localZ`" (hoop 0 stays at z=0, stack reflects into −Z) —
  the acceptance's "hoop-0 z ↔ hoop-N z" wording was loose; the reflection is golden-tested. Voice path still
  omits `hoopSpacingMm`/`diameterIn` — a PRE-EXISTING gap, out of S10 scope (flagged, not introduced here).
- S11: also mirrors each drum's `effectOriginWorld` (needed for radial-effect consistency under mirror);
  `setKitGlobal` left out of the output-reapply set (mirror never changes `dmxMap`, so structural broadcast +
  autosave suffice). Both are sound.

## Context pack for dependent groups/lanes

- **`setKitGlobal`** (protocol + both hosts' `setKitGlobal` handler → `reloadKit`) is the new carrier pattern
  for any kit-WIDE geometry field — copy it, not the per-drum `setKitTransform`.
- Group L (PixLite) does not depend on D. No protocol/output-stream behavior changed (geometry-only).
