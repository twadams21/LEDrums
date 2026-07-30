# Lane: INIT-13 core-surface-trims (whole initiative, S1–S6)

Read `lanes/COMMON.md` — it binds. Branch: `init/13-core-trims` off
`review/impl` (start at origin HEAD; re-measure baseline at your starting HEAD
and report it). Steps from `09-synthesis/INIT-13-core-surface-trims.json`, in
step order. Small initiative (~34 LOC of deletion) — the value is the EVIDENCE
DISCIPLINE, not the diff size. `11-decisions.md` line "INIT-13: throwing-form
wrapper and listCanvasScenes both delete" pre-authorizes S4 and S5 — the
plan's "gated on Trent" note on S4 is SATISFIED, do not re-ask.

- S1 FIRST: freeze the no-caller proof + measured baselines as reproducible
  machine output committed alongside the deletions (a deleted zero-caller
  export has no test that can go red — the grep artifact IS the evidence).
  Programme caveat that binds your method: knip is structurally blind to
  packages/core's barrel-as-entry surface — grep/typecheck evidence, not knip.
- S2: rewrite pixel-grid tests onto nearestPixelIdWithin (the primitive) —
  brute-force equivalence property preserved.
- S3: delete nearestPixelWithin (the allocating convenience wrapper).
- S4: delete assertTriggerGraphIntegrity (pre-authorized, see above) — the
  module's policy is coded issues[] as data, not throws.
- S5: delete listCanvasScenes (pre-authorized).
- S6: re-measure the export surface; the interface delta must EQUAL the
  claimed symbol list — no orphaned imports, no newly-unused private helper.
- ANCHOR WARNING: INIT-06 just rewired core/voice (NodeKind canonical-only,
  node-view.ts new, scope-lint on shared grammar, graph-integrity untouched by
  06 but verify line anchors). Re-verify each symbol's zero-caller status at
  YOUR HEAD — 06's changes could have added or removed callers since the plan.
- packages/core purity rules bind. Gates green per committed step.
- Report: per-step shas, gates numbers, the frozen evidence artifact path,
  before/after export-surface delta, deviations.
