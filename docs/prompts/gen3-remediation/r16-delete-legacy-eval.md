# R16 — Delete the legacy pre-Gen3 eval path (GH #95)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 95 -R twadams21/LEDrums`, then the parent spec's Phase 4.1
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

One evaluator is the only evaluator: delete the dead legacy pre-Gen3 eval
path in `packages/core` and its hand-copied web-sim mirror (~560 duplicated
lines in `apps/web/src/lib/trigger-lab/`). Strictly no behaviour change —
the Gen3 path already handles everything live. Verify deadness before
deleting (trace imports/exports/call sites); remove tests that target only
the dead path; keep tests that assert live behaviour.

Sibling note: R13 (delay/Mix temporal semantics in the Gen3 evaluator) is
queued behind you in the same area — delete only, don't refactor the live
Gen3 evaluator while you're in there.

Full suite + typecheck green; report the line counts removed.
