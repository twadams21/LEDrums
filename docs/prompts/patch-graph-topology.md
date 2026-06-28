# Patch Graph — real device-routing topology (matches the hardware wiring)

Implementer agent (opus, xhigh). Apply **/codebase-design** + **/make-interfaces-feel-better**. Branch
**`feat/unified-shell`**. Report to parent (`--session parent`). No push/PR/merge.

## Goal
Replace the current static 5-node `PatchGraphView` with the REAL input→device routing topology the user
wires (they supplied a reference diagram). It is a left→right node graph with these stages/columns:

1. **Sensory Percussion** (single input node, far left).
2. **Triggers** — one per drum: `Kick Trigger`, `Tom1 Trigger`, `Snare Trigger`, `Tom2 Trigger`.
   Input → each Trigger.
3. **Zones** — each Trigger → its zones. Kick has **Centre, Shell**; Tom1/Snare/Tom2 each have
   **Centre, Edge, Rim, Shell**. (Derive per-drum zones from the kit/pads; don't hardcode if avoidable.)
4. **Drum** — one per drum: `Kick Drum`, `Tom1 Drum`, … . All of a drum's Zones converge → its Drum node.
5. **Hoops** — each Drum → its hoops `<Drum> Hoop 1..N` (N = kit `hoopCount`, currently 4).
6. **Data Lines** — Hoops → Data Line nodes. Multiple data lines, and hoops may **cross-wire** (a
   drum's hoops can split across data lines, and a data line can carry hoops from more than one drum) —
   this models the physical run. Derive from the output/DMX mapping where available; else a sensible
   default grouping (flag it).
7. **Outputs** — Data Lines → Output nodes (the Art-Net/sACN pixel controllers' ports).
8. **Controller** — all Outputs → a single `Controller` node (far right).

Signal reading: input→trigger→zone→drum is the INPUT mapping; drum→hoop→dataline→output→controller is
the physical OUTPUT wiring. Both in one graph (that's intended — it's the full path).

## How to build it
- **Use `@xyflow/svelte`** (already a dependency) for the node graph — nodes, bezier edges, pan/zoom,
  and a clean auto-layout for ~50 nodes across 8 columns. (If layout is fiddly, a deterministic
  column-based x/y placement is fine.) Keep it on the project tokens (oklch/graphite + role colours);
  no invented colours. Signal-path role colours on the node icons (input/content/effect/layer/output)
  per the design system.
- **Data-driven**: derive drums + per-drum zones from `store.drums` + `store.pads` (zones), and hoop
  counts from the canonical kit (`@ledrums/core` `DEFAULT_KIT` drums' `hoopCount`, or `store.serverModel`
  drums). Build a small **pure topology module** (`lib/app/patch-topology.ts`, unit-tested) that turns
  (drums, zones, hoopCount, dataLines/outputs) → `{ nodes, edges }` so the view is thin and the wiring
  is testable.
- **Selecting a node loads it into the Inspector** via `shell.select({ kind: 'patch', nodeId })`
  (extend `PatchNodeId`/selection typing as needed in `shell-nav.ts` — small, coordinate). Keep it
  read-only-friendly; editing device settings can be a later slice (flag).
- Data Lines / Outputs / cross-wiring: the true mapping lives in the server's DMX map (not currently on
  the client). For v1, represent the topology with a sensible default (e.g. group hoops into data lines
  by the kit's `maxPixelsPerOutput`/output config if reachable, else a fixed fan-in) and **FLAG** that
  wiring it to the real server `dmxMap` (over WS `state`) is the follow-up — do NOT fake precise
  universe/channel numbers.

## File boundaries (shared tree)
YOU OWN: `apps/web/src/lib/app/views/PatchGraphView.svelte`, a new `apps/web/src/lib/app/
patch-topology.ts` (+ test), and minimal `apps/web/src/lib/app/shell-nav.ts` selection-typing edits if
needed. Prefer READ-ONLY of `store` (drums/pads/serverModel). DO NOT edit `store.svelte.ts`,
`setlist.ts`, `SectionsView.svelte`, `packages/core/**`, or `Scene.svelte` (sibling agents own those).

## Gate + report
Full `pnpm typecheck` + `pnpm test` before reporting (paste output). Unit-test the topology module
(correct node/edge counts + the convergence/fan-out shape). Sanity-check on :5173 (Patch view renders
the full graph; clicking a node fills the Inspector). Then:
```
twux send-message --session parent --slice-status "<short>" --body "<topology module + view design, node/edge counts, what's data-driven vs defaulted, the data-line/output flag, tests, pasted typecheck+test output>"
```
If you hit the usage limit mid-edit, commit WIP and stop.
