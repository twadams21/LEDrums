# Component pass S3.3 — Split sim.ts into modules

PRD §S3.3. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **PR mapping:** PRD
finding (god-file). **Independent worktree — API-preserving.** Pairs with **S4.4** (canonical graph types):
do the split here; S4.4 then re-points sim's graph types to core. Keep them sequential (S3.3 → S4.4) or note
overlap.

**Blocked by:** none — can start immediately (own worktree). S4.4 (canonical types) runs AFTER this.

## What this delivers
`sim.ts` (1169) — the local trigger-eval simulator — split by concern along its existing `sim.*.test.ts`
seams, keeping the public sim API used by the store unchanged.

## Scope (`apps/web/src/lib/trigger-lab/`)
- Extract: `sim.envelopes.ts` (~170 — ADSR shapes/sampling), `sim.trigger-source.ts` (~130 — TriggerSource
  matching + `normalizeTriggerValue` seam), `sim.graph-compilation.ts` (~220 — block→graph, velocity-switch
  fold). `sim.ts` keeps the Sim class + voice lifecycle + `evalNode` (~650).
- Preserve the exported surface the store imports (`resolveGraphsForFire`, the Sim class, etc.) — structure
  only, no behaviour change.

## Tests
- `sim.value-switch.test.ts`, `sim.velocity-fold.test.ts`, `sim.trigger-routing.test.ts`,
  `sim.trigger-source.test.ts` must stay green untouched. Re-point imports if a test reaches an internal now
  in a submodule, but don't change assertions.

## Gate discipline
Per-package typecheck/test; full sweep on commit. Web test count must not drop. Pure TS.

## Acceptance
`sim.ts` split into 4 cohesive modules; public sim API intact; all `sim.*` tests green; full sweep green.

## Report back
Report to parent (orchestrator) with commit SHA, the module split + sizes, gate totals, deviations, and a
note for S4.4 on where the graph types are referenced. Leave ROUTER to the orchestrator.
