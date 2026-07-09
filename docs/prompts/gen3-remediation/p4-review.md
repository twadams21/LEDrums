# Phase 4 review — code health (R15 #94 · R16 #95 · R17 #96 · R18 #97 · R19 #98 · R20–R24 #99–#103)

You are the Phase 4 review gate for the Gen3 UX remediation initiative.
All Phase 4 tickets are merged into `gen3r/final-wave` (the branch you are on;
PR #117). R16–R18, R20, R21 merged earlier (shipped in PR #113); R15, R19,
R22–R24 merged in this final wave.

## Scope
Phase 4 = "code health": one evaluator (R16 legacy eval deleted), sim uses
core types (R17), render-plan cache (R18), compile-output prune (R19), and
the five-slice store split (R20–R24: controller-monitor, midi-controller,
controller-test, shows-controller, sections-controller). Plus R15's carried
nit fixes. Implementation reports: `docs/reports/2026-07-{09,10}-gen3-r{15,16,17,18,19,20,21,22,23,24}.md`.

Surfaces:
- `apps/web/src/lib/trigger-lab/{store.svelte.ts,controller-monitor,
  controller-test,midi-controller,shows-controller,sections-controller}*.svelte.ts`
- `apps/web/src/lib/trigger-lab/sim.ts` (evaluator deletion + type imports)
- `packages/core/src/voice/{render-plan,scope-lint,reachability-lint}.ts`
- `apps/web/src/lib/ui/LintCallout.svelte` + inspector wiring (R15 nit 1)

## How
Run `/code-review` over that scope against the spec's Phase 4
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`) + issue ACs:
- Split correctness: the five controllers are constructor-injected, no
  hidden cross-controller reach-ins (hosts only), store API byte-compatible,
  no duplicated state between store and controllers (single source of truth
  per rune).
- The R15 sweep already covered batch-wide drift (report Part 2, findings
  filed as #114–#116) — do NOT re-report those; verify NEW hazards only,
  especially interactions among the same-file R22/R23/R24 merges and
  between R19's prune and the lint/cache consumers.
- Cache invariant (`renderPlanSignature` doc comment) still holds after R19.
- Determinism/purity: no Node/DOM imports added to core; controllers own
  their IO via injected hosts.
- Undo-stack integrity across the extracted controllers (snapshots still
  capture controller-owned state where they did before).
Do NOT modify code. Scoped tests only (workers capped per CONVENTIONS).

## Deliverables
1. Committed review report `docs/reports/2026-07-10-gen3-p4-review.md` on
   branch `gen3r/p4-review-report` (blocking / should-fix / nit, each with
   file:line + concrete failure scenario).
2. `twux send-message --session parent --status done --body "P4 review: <counts>. Branch ..., report ..."`
