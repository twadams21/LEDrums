# 08 — Right-dock resize rail + drum flip / kit mirror

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

Two small, well-bounded features.

## A. Resize rail between visualiser and inspector (right dock)

### Current state

- `apps/web/src/lib/app/AuthorShell.svelte` — right dock is a fixed grid:
  `.dock { grid-template-rows: minmax(180px, 1fr) minmax(0, 1.2fr) }` (markup :115-129, styles
  :260-265) with `.viz` (Visualizer) on top and `.lower` (Inspector/Monitor tabs) below.
- `apps/web/src/lib/ui/Splitter.svelte` (:1-162) is a controlled primitive: caller owns the px
  size, Splitter reports clamped deltas via `onResize`; supports orientation/invert/min/max +
  absolute positioning. Already used 3× in AuthorShell (:136-167: left rail, right dock width,
  bottom layers height) with persistence via `store.paneSizes` keys (`authorRailW` 220,
  `authorDockW` 360, `authorBottomH` 148; setter pattern :72-74).

### Design

Fourth splitter, same pattern: new pane constant `DOCK_VIZ = { key:'authorDockVizH', def: 300,
min: 150, max: 600 }`; `.dock` rows become `var(--dock-viz-h) minmax(0, 1fr)`; horizontal
`Splitter` absolutely positioned on the seam between `.viz` and `.lower` (mirror the
layers-splitter placement :157-167). Persisted automatically through `paneSizes` (per-show by
design). Test: pure clamp/persist already covered by Splitter; add a paneSizes-key presence test
if the existing suite asserts keys.

## B. Flip a drum / mirror the kit

### Problem

Quick layout correction: (1) per-drum flip — the drum was mounted upside down, so bottom/top skins
are swapped; (2) whole-kit mirror in X or Y — the kit is set up stage-left vs stage-right.

### Current state

- Geometry model: `packages/core/src/geometry/kit-schema.ts:10-30` `drumSchema` — `origin`,
  `rotation`, `localSpinDeg`, `startAngleDeg`, `pixelsPerHoop`, `hoopSpacingMm`, `diameterIn`.
  Kit-globals :82-88 (`hoopCount`, density, default spacing). **No flip/mirror concept exists
  anywhere** (per-drum or kit-level).
- Geometry build: `packages/core/src/geometry/pixel-model.ts:83-155` `buildPixelModel` — per hoop
  per pixel: `angle = startAngleDeg + localSpinDeg + 360·i/perHoop` (:102), local
  `{x: r·cos, y: r·sin, z: localZ}` (:104-108), world via `localToWorld(local, rotation, origin)`
  (:109).
- Transform flow: `PatchDrumInspector.svelte:28-31` → `store.setDrumTransform`
  (`store.svelte.ts:1263-1266`, local apply + WS `setKitTransform`) →
  `apps/server/src/input-router.ts:171-179` → voice host `reloadKit()`
  (`voice-engine-host.ts:148-167`) rebuilds the model live.
- **Latent bug found during exploration**: `pixelsPerHoop` is in the protocol (`protocol:52`) but
  the legacy-engine path drops it — `input-router.ts:171-179` doesn't forward it and
  `engine.ts:298-303`'s `Pick` type excludes it (voice host handles it; dev runs voice mode, so
  impact is legacy-mode only). Fix alongside this work.

### Design

Flips are **geometry-only** transforms: they change pixel XYZ (what effects and the visualiser
see), **not** pixel index order — the Art-Net output stream and dmxMap are untouched, so flipping
never re-patches hardware. State this invariant in code (comment) and tests.

1. **Per-drum flip** — `flip?: boolean` on `drumSchema`. Semantics: mirror the drum along its
   local Z (skins swap) = negate `localZ` in `buildPixelModel` **and** negate the angular
   direction (mirror = one reflection, so wind direction reverses: `angle → -angle` before
   start/spin offsets) so chase direction reads correctly on a physically flipped drum. Hoop
   indices/pixel order unchanged.
2. **Kit mirror** — `mirror?: 'none'|'x'|'y'` on `kitGlobalSchema`. Applied as a final world-space
   reflection in `buildPixelModel` (negate world x or y for every pixel, and reflect
   tangent/normal vectors consistently). Drums keep their identities (kick stays kick) — only
   coordinates reflect.
3. **Plumbing**: extend `DrumTransformPartial` (`store/trigger-routing.ts:11-19`) + WS
   `setKitTransform` with `flip`; add kit-global mirror to the same message (or a sibling
   `setKitGlobal`) → `input-router.ts` forwarding (fix `pixelsPerHoop` here too) → engine/voice
   host `Pick` types → `reloadKit`.
4. **UI**: `PatchDrumInspector.svelte` gets a "Flip drum" toggle; kit mirror lives on the Patch
   view — no kit-level inspector exists today, so either a small toolbar control on the Patch
   canvas or a Kit node/inspector (PRD choice; toolbar is least invasive).

### Tests (core, golden-style like the S6 byte-exact suite)

- flip twice = identity (positions byte-equal); flip preserves pixel count/index order and dmxMap
  bytes exactly; skins swap (z of hoop 0 ↔ hoop N-1); angular direction reversed.
- mirror x/y: world coords reflected, tangents consistent, dmxMap unchanged; mirror+flip compose.
- input-router forwards flip/mirror/pixelsPerHoop (regression for the latent bug).

## Touch list

- `apps/web/src/lib/app/AuthorShell.svelte` (splitter)
- `packages/core/src/geometry/kit-schema.ts`, `pixel-model.ts`
- `packages/protocol` (`setKitTransform` fields), `apps/server/src/input-router.ts`,
  `packages/core/src/engine/engine.ts:298` Pick, `apps/server/src/voice-engine-host.ts`
- `apps/web` `store/trigger-routing.ts`, `store.svelte.ts`, `PatchDrumInspector.svelte`, Patch
  view kit-mirror control
