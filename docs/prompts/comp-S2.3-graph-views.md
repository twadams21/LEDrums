# Component pass S2.3 — Graph views: shared canvas + flow-controller + bug fix

PRD §S2.3. Overlay PRs **#9** (shared SvelteFlow workspace), **#10** (patch flow controller — **D3 LOCKED:
fold in here; extract a standalone controller ONLY if the view doesn't shrink enough**), **#11** (REAL BUG),
and the **#17** `LayersDock.busIcon` remnant. Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **Depends on S0.2** (lab/NodeCanvas gone). Owns the graph views — disjoint from
S2.1/S2.2.

## What this delivers
PatchGraphView + TriggerGraphView stop duplicating SvelteFlow canvas/palette/fit boilerplate, share it, fix
a real geometry bug, and get their view-orchestration tidied.

## Scope (`apps/web/src/lib/app/views/`)
- **Shared canvas (#9):** extract the duplicated `<SvelteFlow>` setup (Background/Controls/Palette/FitView
  config, node/edge types, hover wiring) into a `GraphCanvas.svelte` consumed by both views.
- **Unify palette + fit:** `PatchPalette` + `TriggerPalette` → one `GraphPalette.svelte` (array of
  device/node kinds + click handler); `PatchFitView` + `TriggerFitView` → one `GraphFitView.svelte`
  (parameterized padding/watch/onfitted). Extract `GraphListRail` from TriggerGraphView (section header +
  graph list + new button). Extract `BandSwitchNode` from `TriggerNode.svelte`.
- **#11 BUG FIX:** the Patch graph's INPUT half computes hoop counts from `DEFAULT_KIT` while the OUTPUT half
  is already project-authoritative. Fix `patch-topology.ts` (the input/zone/drum/hoop builder) to derive
  hoop counts from `store.project.kit` like the output half does, so non-default kit geometry renders
  correctly upstream. Add a test asserting input-half counts follow a non-default `pixelsPerHoop`.
- **#10 flow controller (D3):** as you extract `GraphCanvas`, pull the view-orchestration glue
  (adopt/signature-guard/rewire→recompile→store) into a small controller module **only if** PatchGraphView
  doesn't shrink enough on its own. Note in your report whether you extracted it or inlined it.
- **#17 remnant:** fix `LayersDock.svelte`'s `busIcon` helper (the only live bit of the deleted NodeCanvas
  metadata) so bus icons resolve correctly.

## Tests
- Keep `graph-to-flow.test.ts` + `patch-graph.test.ts` + `patch-topology.test.ts` green; add the #11
  non-default-kit input-half test.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.
Keep the locked graph UX (no node lift/click motion; instant hover; drop-anywhere-on-node wiring).

## Acceptance
Both graph views render through shared `GraphCanvas`/`GraphPalette`/`GraphFitView`; #11 input geometry
follows the project kit (tested); graph UX feel unchanged; full sweep green. Closes #9/#10/#11/#17.
(Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent (orchestrator) with commit SHA, new shared components, whether #10 was extracted vs inlined,
the #11 fix + test, gate totals, owed spot-check, deviations. Leave ROUTER to the orchestrator.
