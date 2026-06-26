# Brief — Switch node: value-based routing (gate + bands with per-band handles)

You are a **twux implementer agent** on LEDrums (branch `feat/unified-shell`). Read this whole brief,
then `.mex/ROUTER.md` (project state + the behavioural contract / GROW loop) and `CLAUDE.md`
(non-negotiables) before coding. Report back to your parent when done (command at the bottom).

## Goal

Add a new **`value`** routing mode to the Trigger graph's **switch** node, with two operator-chosen
sub-modes:

- **Gate** — one threshold + an **invert** toggle. Passes its (single) output through only when the
  trigger's value is on the passing side; default = pass when value ≤ threshold (does nothing above),
  invert = pass when value > threshold (does nothing below).
- **Bands** — N user-defined contiguous bands, each with a settable cutoff; **each band is its own
  output handle on the node**, so you wire a different child per band. The value lands in exactly one
  band → that band's wired children fire.

This is **additive and non-breaking**: existing switch modes (`velocity | section | beat`) keep their
current even-split-by-child-count behaviour. You are ADDING `value`, not changing the others.

## Locked design decisions (do not re-litigate)

- **Value is normalized 0–1**, shown in the UI as a percentage. The trigger's value today is
  `ctx.velocity` (already 0–1) — use that as the value source. (MIDI/OSC value sources arrive later
  with separate trigger-source work; out of scope here.)
- **`on: 'value'` is a NEW option** added alongside `velocity | section | beat`. Don't remove or
  re-key the existing modes; existing persisted graphs must keep working untouched.
- **Nodes stay display-only; all editing is in the Inspector** (the established pattern from the
  recent xyflow unification). So: cutoff sliders, add/remove band, gate threshold + invert all live in
  the **Inspector**. The **node** only *renders* the band handles + a small per-band label/readout.

## Current model (what you're extending) — `apps/web/src/lib/trigger-lab/sim.ts`

- `type SwitchOn = 'velocity' | 'section' | 'beat'` (line ~21).
- `interface GraphNode` (~260): flat fields per kind (`on: SwitchOn`, `p`, `noRepeat`, …). `makeNode`
  (~308) seeds defaults.
- `interface GraphEdge { id; from; to }` (~283) — **no source-port today** (single output per node).
- `childrenOf(graph, node)` (~617): all edges `from === node.id`, mapped to target nodes, **sorted by
  y** (top→bottom) for determinism.
- `evalNode` switch case (~666): `i = switchIndexN(kids.length, node.on, ctx)`, then eval `kids[i]`.
- `switchIndexN` (~770): `velocity → frac = ctx.velocity`; `section → sectionIndex % n`;
  `beat → frac = ctx.beatPhase`; frac→index across n even bands. `ctx` carries `velocity`,
  `sectionIndex`, `sectionCount`, `beatPhase`.

## Model changes

1. `SwitchOn` += `'value'`.
2. `GraphNode` new flat fields (seed in `makeNode`; only meaningful when `kind==='switch' && on==='value'`):
   - `valueMode: 'gate' | 'bands'` (default `'gate'`)
   - `threshold: number` (0–1, default `0.5`) — gate cutoff
   - `invert: boolean` (default `false`) — gate direction
   - `bands: number[]` — ascending cutoffs for bands mode; **N bands = N−1 cutoffs**, last band is
     "the rest". Default `[0.5]` (→ 2 bands: ≤50% and >50%).
3. `GraphEdge` += `fromPort?: string` — the **source handle id** an edge leaves from. `undefined` =
   the node's default single output (back-compat; all existing edges + all non-bands nodes use this).
   For a `value`+`bands` switch, band i's handle id is **`band-${i}`** (i = 0…N−1).

Back-compat: old persisted switch nodes only ever have `on: velocity|section|beat`, so the new fields
are never read for them. When the user FIRST sets a node to `on:'value'`, the store backfills the
value-mode defaults if absent. Tolerate missing new fields everywhere (default them).

## Evaluation (`evalNode` / helpers in sim.ts) — keep deterministic + pure

- `on:'value'` + **gate**: `pass = invert ? value > threshold : value <= threshold` (value =
  `ctx.velocity`). If pass → eval all children on the default output (`childrenOf`, by y). Else → `[]`.
- `on:'value'` + **bands**: resolve band index `b` for `value` against the ascending `bands` cutoffs
  (value ≤ bands[0] → 0; ≤ bands[1] → 1; …; else last). Then eval the children wired from **that
  band's handle** — i.e. edges with `fromPort === `band-${b}``. Add a `childrenViaPort(graph, node,
  port)` helper (mirror `childrenOf` but filter `e.fromPort === port`, still y-sorted). A band with no
  wired child → `[]`.
- `velocity | section | beat` unchanged.

Unit-test the resolver + eval thoroughly (gate pass/block/invert; band boundary picks incl. value at a
cutoff and value above the last cutoff; empty band). Add to the sim/graph tests.

## Wiring the source handle through (the fiddly part)

- **`graph-to-flow.ts`** — for a `value`+`bands` switch, emit **N source handles** (ids `band-0`…
  `band-${N-1}`); other nodes/modes keep their single source handle. Map `edge.fromPort` →
  xyflow `sourceHandle` and back.
- **`TriggerNode.svelte`** — render N right-edge source `Handle`s for a bands switch (each
  `id={`band-${i}`}`, vertically distributed), with a small band label + cutoff readout per row
  (display only). Gate/other modes render the existing single handle. Use the Svelte MCP server /
  `svelte:svelte-file-editor` and re-validate.
- **`TriggerGraphView.svelte` onconnect/onreconnect + WireEdge** — carry `connection.sourceHandle`
  into the store so the edge records `fromPort`. `store.connect`/`store.reconnect` must accept +
  persist a source-port. (Validation unchanged: dup/cycle/direction.)

## Inspector — `apps/web/src/lib/app/docks/Inspector.svelte` (switch editor)

- Add `value` to the switch `on` selector.
- When `on==='value'`: a **Gate | Bands** segmented toggle.
  - **Gate**: a threshold `Slider` (0–1, shown as %) + an **invert** `Toggle`.
  - **Bands**: a list of bands — each row a cutoff `Slider` (0–1 %, kept ascending) with remove; an
    "add band" tile. Adding/removing a band updates `node.bands` (and the node's handles follow).
- New store mutators (validate kind/on): `setValueMode`, `setThreshold`, `setInvert`, `addBand`,
  `removeBand`, `setBandCutoff` (clamp + keep `bands` sorted ascending, 0–1).

## Constraints + gate discipline

- All work in `apps/web` — do NOT touch `packages/core` / `packages/io`. Svelte 5 runes; match
  surrounding idioms. Use the Svelte MCP for every `.svelte` file.
- During work: `pnpm --filter @ledrums/web typecheck` (ignore the cross-package one going red on WIP).
  Tests: `pnpm --filter @ledrums/web test`. Don't break the existing suite (109 web tests).
- The store is the source of truth + autosaves; every edit flows through store mutators (so persistence
  + the live engine re-sync keep working). New node/edge fields serialize automatically via
  `$state.snapshot` in `toAuthored`.
- **Commit per phase**; the orchestrator verifies via git. Suggested phases:
  1. sim model + eval + unit tests (pure, lands first)
  2. store mutators + connect/reconnect carry `fromPort`
  3. graph-to-flow + TriggerNode multi-handle rendering + WireEdge sourceHandle
  4. Inspector switch-value editor (gate + bands)
- After the work, run **GROW**: note the switch-`value` capability in `.mex/ROUTER.md` (and the
  redesign plan's trigger-model section if apt), bump `last_updated`.

## Report back (verbatim)

When finished (or blocked):

```
twux send-message --session parent --status "<one-line status>" \
  --body "<commits per phase; gate results (web typecheck + test counts); model/edge changes; deviations + why; live :5173 spot-checks (gate pass/block/invert; bands routing + per-band handles wire correctly)>"
```

Report honestly — partial phases, anything you couldn't verify (you can't drive a browser; list the
:5173 checks for the orchestrator). Commit as you go; don't leave work uncommitted.
