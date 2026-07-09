# R11 — Sections DnD: insertion line + section-target outline (GH #90)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 90 -R twadams21/LEDrums`, then the parent spec's Phase 2.3
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Dragging a graph row shows an accent insertion line at the hovered gap;
reordering a section shows a column outline on the drop target. Indicators
clear on drop/cancel. The user must be able to predict the drop before
releasing.

UI work: `/make-interfaces-feel-better`, ui-shot states for both
indications, design system regenerated if new styles are reusable.

Sibling note: R12 (grip icon on graph rows + canvas drag-over highlight) is
queued behind you on the same view — don't add the grip icon or touch the
graph canvas drop-target styling.
