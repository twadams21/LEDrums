# S6 — Data lines first-class + dense routing + kit pixel defaults

The biggest slice of the **Patch Graph authoritative** mission (`docs/prompts/patch-graph-authoritative.md`). Branch `feat/unified-shell`. End-to-end: core + io/server byte-packing + web round-trip + Inspector. **A sibling agent (S7) is concurrently editing `apps/server/src/main.ts` + `input-router.ts` + a persistence module — you must NOT touch those files.** Your only server file is `apps/server/src/output-manager.ts`.

## Why
Trent's real rig is a PixLite **A4 in expanded mode**: 4 physical outputs, each driving **2 data lines** (Data + repurposed Clock) = **8 data lines**, 2 hoops in series per line → **16 hoops → 8 data lines → 4 outputs → 1 controller**. The current model has no data-line concept (`OutputConfig` is flat `segments[]`), so wiring 8 data lines collapses back to 4 (round-trip flattens + re-chunks). And routing must be **dense**: pixels packed channel-by-channel from universe 0, contiguous across the whole chain, **pixels/strips/data lines may straddle universe boundaries**. The controller owns universe mapping; we author order + density.

## Part A — Data lines first-class (core schema)
`packages/core/src/geometry/kit-schema.ts`:
- New `dataLineSchema = { id: string, startUniverse?: number (int, optional), segments: OutputSegment[] (min 1) }`.
- `outputSchema` becomes `{ id, channelsPerPixel (default 3), startUniverse?: number (optional), dataLines: dataLineSchema[] (min 1) }` — **replace** the flat `segments` with ordered `dataLines`.
- **Back-compat:** accept a legacy output carrying bare `segments` (no `dataLines`) via a zod `preprocess`/`transform` → wrap it as a single implicit data line `{ id: '${output.id}:dl0', segments }`. (Live persistence may have written the old shape; never crash on it.)
- **Keep** `maxPixelsPerOutput` in `kitGlobalSchema` (engine + voice host still reference it) — do NOT remove the field.

## Part B — Dense channel packing with straddle (the core of it)
`packages/core/src/geometry/dmx-map.ts` + `apps/server/src/output-manager.ts`:
- Walk the chain in transmit order: **outputs → dataLines → segments → hoops → pixelIds** (each segment expanded `hoopStart..hoopEnd` ASCENDING; each hoop → its `pixelsPerHoop` pixel ids).
- **Dense channel cursor:** pixel *i* in the sequence occupies global channels `[cursor, cursor + cpp)`, then `cursor += cpp`. `universe = floor(channel / 512)`, `channelInUniverse = channel % 512`. **A pixel's `cpp` channels MAY straddle a 512-channel universe boundary** (e.g. ch 510,511 in universe N + ch 0 in universe N+1). This is the whole point — do not pad pixels to fit a universe.
- **Optional universe jumps:** if an **output** or a **data line** declares a `startUniverse`, snap the cursor to that universe's channel-0 (`startUniverse * 512`) when entering it (a deliberate boundary/gap). Absent → stay dense/contiguous (output 1 dl1 → output 1 dl2 → output 2 dl1 …, no reset). The overall base starts at universe 0, channel 0.
- **Remove the hard cap:** delete the `outputPixelCount > maxPerOutput` throw — no hardcoded pixel cap (the controller enforces its own; the field stays but is advisory only).
- **DmxMap shape:** restructure so straddle is representable and `output-manager` can emit correct universe bytes. Suggested: `perPixel[pid] = { channel: globalChannelStart }`, plus the sorted set of active `universes`. Then `output-manager.frameToUniverseBytes` builds each active universe's 512-byte buffer by writing every pixel's `cpp` channels at their global positions, clipping to that universe's `[U*512, U*512+512)` window (so a straddling pixel writes part here, part in the next universe). Keep the Art-Net/sACN senders' `send(universe, Uint8Array)` interface unchanged — only the byte assembly changes. Apply `rgbOrder` as today.
- **Golden tests (byte-exact):** e.g. drum A hoop @196px then drum B hoop @108px on one line → assert the boundary pixel (≈ pixel 170) straddles universe 0→1 at the right channels; assert an explicit `startUniverse` snaps to that universe's ch 0; assert two outputs pack contiguously without a gap when no `startUniverse`.

## Part C — Kit pixel defaults
Set the authoritative literal `pixelsPerHoop` (see `docs/kit-hoop-pixel-counts.md` / memory) on the kit defaults: **Kick 196, snare 108, tom1 108, tom2 136** — in core `DEFAULT_KIT`/`defaults.ts` drums **and** the web fixtures (`apps/web/src/lib/trigger-lab/fixtures.ts` / `kit.ts`, whichever seeds drums). Per-drum, all hoops same.

## Part D — Web round-trip preserves data lines
- `apps/web/src/lib/app/patch-routing.ts`: `patchToOutputs`/`outputsToPatch` now map data lines **1:1** (no flatten, no re-chunk) — a `PatchOutput.dataLines[i]` ↔ `OutputConfig.dataLines[i]`. `pixelRanges` already walks data lines (keep). Update tests: wiring 8 data lines round-trips as 8.
- `apps/web/src/lib/app/patch-graph.ts` + `views/PatchGraphView.svelte`: `routingFromGraph` already groups by dataline node; ensure the data-line grouping persists through `setRouting` and redraw (the **wire-in-8-stays-8** acceptance). Respect locked graph UX (memory `graph-interaction-prefs`).
- `apps/web/src/lib/app/docks/Inspector.svelte`: the data-line node editor gains an **optional `startUniverse`** field (blank = dense/auto), alongside its existing first/last-pixel read-out. Output node likewise keeps its optional `startUniverse`. (Do NOT add hoop-spacing here — that's a separate follow-up.)

## Out of scope (do NOT touch — sibling/owned elsewhere)
- `apps/server/src/main.ts`, `input-router.ts`, persistence (S7).
- `setKitTransform`/`setKitOutputs` **message shapes** (`ws-protocol.ts`, web `protocol-types.ts`) — `setKitOutputs` already carries `OutputConfig[]` and is transparent to the shape change; you should not need to edit the message. If you find you do, STOP and tell the parent (contention).
- Hoop-spacing on the drum node (separate fast-follow).

## Gate discipline
- During work: `pnpm --filter @ledrums/core typecheck`, `--filter @ledrums/server typecheck`, `--filter @ledrums/web typecheck` (the core shape change ripples to web — keep them green per-package as you go). Full `pnpm typecheck && pnpm test` only on your committed clean tree.
- Use the **Svelte MCP / `svelte:svelte-file-editor`** for `.svelte` files; autofixer clean.
- Strong tests on Part B (byte-exact) and Part D (8-data-line round-trip).

## Acceptance
- Wiring 8 data lines stays 8 (no collapse) and survives redraw/reload.
- DMX output is dense + contiguous, pixels straddle universes, optional `startUniverse` snaps to a boundary; no hardcoded pixel cap.
- Kit boots with Kick 196 / snare 108 / tom1 108 / tom2 136 px per hoop.
- Full sweep green.

## Report back
Report to parent (`twux send-message --session parent`) with per-part commit SHAs, files, full-sweep totals, the final `OutputConfig`/`DataLineConfig` + `DmxMap` shapes, and any deviation. **Commit before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.
