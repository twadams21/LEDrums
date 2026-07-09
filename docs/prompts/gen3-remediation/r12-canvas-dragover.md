# R12 — Canvas drag-over highlight for add-node drags; grip icon on graph rows (GH #91)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 91 -R twadams21/LEDrums`, then the parent spec's Phase 2.4
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Two affordances:
1. While dragging a new node from the Add pane, the graph canvas shows a
   drag-over highlight (drop target is live); clears on drop/leave.
2. Graph rows swap the whole-row grab cursor for a grip icon — the drag
   affordance becomes explicit, grab cursor confined to the grip.

Context in your branch history:
- **R11** landed the Sections DnD insertion-line/outline conventions —
  match that visual language for "drop target is live".
- **R08/R03** own the intra-canvas wire states (`wire-preview.svelte.ts`
  pattern); your highlight is for add-from-pane drags, a different state —
  mirror the preview-rune pattern for your ui-shot state rather than
  reusing theirs.
- **R10 just landed** in the Add pane (category chips) — drag sources may
  have been restyled; rebase your understanding on current code.
- Locked interaction contract: no lift/click motion, instant highlight
  (memory `graph-interaction-prefs`).

ui-shot state for the canvas highlight (seam op via a preview rune; NO
shots.json entries); design system regenerated only if you add reusable
styles. Apply `/make-interfaces-feel-better`.

Sibling note: R17 (sim types) and R06 (lint badges on node faces + Output
inspector) are running. You own the canvas drag-over surface + graph-row
grips; don't touch node-face badge rendering, the lint model, inspectors,
or sim.ts.
