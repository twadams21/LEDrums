# Phase 2 review — affordances (R09 #88 · R10 #89 · R11 #90 · R12 #91)

You are the Phase 2 review gate for the Gen3 UX remediation initiative.
All four Phase 2 tickets are merged into `codex/gen3-graph-authoring`.

## Scope
- **R09** (#88) add-pane search across categories — merge `da3f8a4`, report `docs/reports/2026-07-09-gen3-r09.md`
- **R10** (#89) category icon chips + de-carded empty state — merge `3bbb613`, report `...-r10.md`
- **R11** (#90) sections DnD insertion line + reorder target — merge `e45da99`, report `...-r11.md`
- **R12** (#91) canvas drag-over ring + graph-row grips — merge `d607341`, report `...-r12.md`

Surface: `apps/web/src/lib/app/views/{AddPalette,add-pane,add-node-taxonomy,
NodeCard,NodeIconChip,SectionsView,SectionGraphRow,TriggerGraphView,
canvas-drop-preview,sections-dnd-preview}*` and the shot-seam ops these added.
Note the surface has since been touched by other merged tickets (R03/R05/R08
share TriggerGraphView) — confine findings to Phase 2's concerns; flag
cross-ticket interactions rather than reviewing the other phases' logic.

## How
Run `/code-review` over that scope. Judge against the spec's Phase 2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`) + issue ACs:
- Search: all categories searched, grouped flat results, no regression from
  R10's tile restyle.
- DnD affordances: locked interaction contract (NO lift/click motion,
  instant highlight); preview runes DEV-only (dead-code-eliminated), never
  leak into prod behaviour; drop handlers can't be intercepted by overlay
  elements (pointer-events).
- Consistency: one visual language across R10 chips / R11 targets / R12
  ring; design-system entries exist for the new primitives (NodeIconChip).
- Accessibility: affordances not colour-only; keyboard paths not regressed.

Do NOT modify code. Scoped tests only (workers capped per CONVENTIONS.md);
`pnpm gates` if you need the full suite. Use your OWN dev-server port for
any ui-shot verification (sibling agents run servers too).

## Deliverables
1. Committed review report `docs/reports/2026-07-09-gen3-p2-review.md` on
   branch `gen3r/p2-review-report` (findings ranked blocking / should-fix /
   nit; each with file:line + concrete failure scenario).
2. Final message: `twux send-message --session parent --status done --body
   "P2 review: <counts>. Branch ..., report ..."`
