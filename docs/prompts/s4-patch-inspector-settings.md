# S4 — Inspector per-node editors (the centerpiece)

Part of the **Patch Graph authoritative** mission (`docs/prompts/patch-graph-authoritative.md`). Branch `feat/unified-shell`. **Depends on S1 (mutations live on the voice host) + S3 (store `project` + mutators) — read both first.**

## Why
This is the headline deliverable: clicking a Patch node opens its **real settings** in the Inspector, and editing them changes real device behaviour. Today the Inspector shows patch nodes read-only (`Inspector.svelte:248` "read-only for now").

## Scope (disjoint file set — yours alone)
- `apps/web/src/lib/app/docks/Inspector.svelte` (add the editable `kind === 'patch'` branch)
- small helpers next to it if needed; a per-node label-override store field (coordinate with S3's store — additive only)
- Use the **Svelte MCP / `svelte:svelte-file-editor`**. Crib field patterns from legacy `apps/web/src/lib/panels/KitEditor.svelte` (drum transforms) and `apps/web/src/lib/panels/OutputConfig.svelte` (Art-Net/sACN), restyled onto `lib/ui/` primitives + oklch/green tokens (no bare HTML controls).

## S3/S2 contract (use these — don't rediscover)
S3 (commit `9f3ac89`) exposes, on the `TriggerLab` store:
- `store.project: Project | null` (adopted from the `state` message; null when offline — your editors must be no-op-safe when null).
- `store.setDrumTransform(drumId, { origin?, rotation?, localSpinDeg?, startAngleDeg?, pixelsPerHoop? })` → `setKitTransform`
- `store.setRouting(outputs: OutputConfig[])` → `setKitOutputs`
- `store.setInputMap(inputMap: InputMap)` → `setInputMap`
- `store.setOutput({ state?, protocol?, host?, rgbOrder?, fps?, broadcast? })` → `setOutput`
  (all optimistic-write the local project + send WS).
- `apps/web/src/lib/app/patch-graph.ts` exports `hoopNodeId`/`parseHoopNodeId`/`outputNodeId`/`parseOutputNodeId` — the **0-based-core ⇄ 1-based-node** id bridge; use it to map a selected patch node id back to a `HoopRef`/output index.
- For the first/last-pixel read-outs use S2's `pixelRanges(routing, pixelsForHoop)` from `apps/web/src/lib/app/patch-routing.ts` (returns `byDataLine`/`byOutput` spans).
- Transmit order is **node vertical (y) position** (S3 convention) — read-outs should reflect that order.

## Per-node editors (see the mission spec table)
- **Zone** node → MIDI note + OSC address that fires it, written into `inputMap` via `store.setInputMap` (key by `(drumId, slot)`; slot = zone index).
- **Drum** node → `origin` (x/y/z), `rotation` (x/y/z), **starting angle** (`startAngleDeg`, note "applies to all 4 hoops"), spin (`localSpinDeg`), and **literal pixels per hoop** (`pixelsPerHoop`) → `store.setDrumTransform`.
- **Hoop** node → pixels-per-hoop (mirrors the drum’s, editable) + **first/last pixel** read-out (from S2 `pixelRanges`).
- **Data line** node → read-out: universe + **first/last pixel**; ordering position.
- **Output** node → `startUniverse`, `channelsPerPixel` (→ `store.setRouting` rebuild) + first/last pixel read-out.
- **Controller** node → Art-Net/sACN transport: protocol (artnet|sacn), host/IP, broadcast/multicast, RGB order, fps — and any **standard** Art-Net/sACN fields the schema is missing (look up the standard set; if you add a field, extend `OutputSettings` minimally and note it for the parent). → `store.setOutput`.
- **All editable nodes** → a rename field (label override), persisted via the store.

## Acceptance
- `pnpm --filter @ledrums/web typecheck` + `test` clean; Svelte autofixer clean on the edited component.
- Selecting each node kind shows the right editor; edits call the right store mutator. (Live "it changed my LEDs/geometry" check is Trent's.)

## Don't
- Don't restructure the shell-nav selection model (it already supports `kind:'patch'`). Don't merge to main. Keep changes inside the Inspector + minimal store additions.

## Report back
Report to parent with commit SHA, files, gate output, any `OutputSettings` schema field you added, and screenshots/notes of each node editor if you can. **Commit on `feat/unified-shell`** first.
