# R15 — Two-axis review sweep + carried nit fixes (#94)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`. Two parts.

## 1. Fix the carried nits (small, mechanical — one commit each)
These were logged by the P1/P5 phase reviews as R15 candidates:
- **Reachability inspector row**: lint strip/badges surface `no-path-to-output`
  / `dead-branch`, but the node inspector has no row explaining reachability
  the way empty-scope got one (see R06's OutputNodeInspector empty-scope row
  for the pattern). Add the inspector row.
- **No-op undo entry on zero-displacement splice**: R08's `spliceOnDrop`
  pushes a position undo entry even when the node didn't move. Guard it.
- **Dead pre-graph Block-tree evaluator in sim**: `apps/web/src/lib/
  trigger-lab/sim.ts` (or wherever it now lives post-R17) still carries the
  legacy Block-tree eval path that nothing reaches since R16. Verify
  consumer-free, delete it and its tests-of-dead-code.
- **`nid()` id-collision** (from R25): the preview/node id helper can collide;
  make it collision-safe (check existing ids or use a counter/entropy).
Verify each with scoped tests; UI change (inspector row) needs a ui-shot
capture + styleguide compliance.

## 2. Two-axis /code-review sweep (read-only)
Run `/code-review` over the full Gen3 remediation batch — everything merged
to `codex/gen3-graph-authoring` for R01–R14, R16–R18, R20/R21, R25–R27,
R29–R31 (spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md`), judged
on two axes: (a) repo standards (AGENTS.md non-negotiables, design system,
core purity) and (b) spec fidelity. The four phase reviews already ran —
do NOT re-litigate their closed findings (reports:
`docs/reports/2026-07-09-gen3-p{1,2,3,5}-review.md`); hunt what a
scoped phase review would miss: cross-phase interactions, batch-wide
drift, dead code, duplicated seams.
Do NOT fix sweep findings and do NOT file GitHub issues — triage them
(blocking / should-fix / nit, file:line, concrete failure scenario) in the
report; the orchestrator files issues.

Full `pnpm gates` before reporting. Report:
`docs/reports/2026-07-10-gen3-r15.md` (committed). Then
`twux send-message --session parent --status done --body "R15: nits fixed <list>, sweep findings <counts>. Branch ..., report ..."`
