# R19 — Verify and drop unused render-plan compile outputs (#98)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`.
Spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md` Phase 4.4.

`packages/core/src/voice/render-plan.ts` — `compileRenderPlan` builds several
outputs (`nodesById`, `planNodesById`, `triggerId`, `outputId`,
`flowChildrenById`, `incomingFlowEdgesById`, `issues`, `fatal`, `graph`).
The lint surface (R05/R06/R07), the plan cache (R18), core eval, and the sim
(post-R16/R17 it delegates to core) are all now consumers. For each output:
- Trace every consumer (core eval, sim, web lint surfaces, tests).
- Outputs with NO consumer outside their own construction: delete, and slim
  `compileRenderPlan` accordingly.
- Outputs the lint surface or cache consume are RETAINED — this ticket only
  prunes, never restructures. If everything is consumed, that's a valid
  outcome: report "nothing to drop" with the consumer evidence table.
- Do NOT touch `renderPlanSignature` semantics or the cache invariant
  comment (read it first — it documents a sanctioned staleness exception).

Scoped tests + `pnpm typecheck` during dev; full `pnpm gates` before
reporting. Report: `docs/reports/2026-07-10-gen3-r19.md` (committed), with
the consumer-evidence table. Then
`twux send-message --session parent --status done --body "R19: <dropped list or none>. Branch ..., report ..."`
