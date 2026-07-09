# Phase 1 review — graph trust (R01 #80 · R02 #81 · R03 #82 · R04 #83 · R05 #84 · R06 #85 · R07 #86 · R08 #87)

You are the Phase 1 review gate for the Gen3 UX remediation initiative.
All eight Phase 1 tickets are merged into `codex/gen3-graph-authoring`.

## Scope
Phase 1 = "graph trust": wires attach immediately (R01), system actions
announce themselves (R02), invalid wires explain themselves in-drag +
on-release (R03), new Effects auto-wire (R04), the lint surface explains
every wired-but-renders-nothing state (R05 strip, R06 badges+empty-scope,
R07 reachability), and node-drop splices wires (R08). Implementation
reports: `docs/reports/2026-07-09-gen3-r0{1,2,3,4,5,6,7,8}.md`.

Surfaces:
- `apps/web/src/lib/trigger-lab/store/{graph-wiring,wire-toasts}*`, store
  `connect/reconnect/spliceOnDrop/addNode` + undo batching in
  `store.svelte.ts` (NOTE: R20/R21 store-split slices have since moved
  monitor/MIDI concerns out — confine store findings to Phase 1 logic).
- `apps/web/src/lib/app/views/{TriggerGraphView,GraphCanvas,WireEdge,
  WireDragValidity,wire-preview,splice-geometry,graph-lint*,GraphLintStrip,
  lint-preview,trigger-flow-projection}*`.
- `packages/core/src/voice/{render-plan,scope-lint,reachability-lint}.ts`
  (lint passes + issues plumbing; the plan CACHE itself was P4/R18 — check
  its interaction with lint, not its own design).

## How
Run `/code-review` over that scope, judged against the spec's Phase 1
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`) + the eight issues' ACs:
- One validator: every wiring path (connect, reconnect, auto-wire, splice)
  routes through the same classify/connect seam — no bypasses.
- Undo shapes: R04 add+wire = ONE entry; R08 position and splice-wiring =
  SEPARATE entries. Verify the batching helpers compose (a splice during
  an auto-wire-adjacent flow can't corrupt the stack).
- Lint: strip↔badge fed from one issue list; the three lint passes
  (structural, scope, reachability) can't contradict or duplicate each
  other on one node; copy is plain + actionable.
- Cache interaction: reachability = structure-only (cache-safe);
  empty-scope param-staleness confined per the renderPlanSignature comment.
- Locked interaction contract on all in-drag states (instant, no motion).
- DEV-only preview runes don't leak into prod paths.

Do NOT modify code. Scoped tests only (workers capped per CONVENTIONS);
`pnpm gates` for the full suite if needed. Own dev-server port for any
ui-shot verification.

## Deliverables
1. Committed review report `docs/reports/2026-07-09-gen3-p1-review.md` on
   branch `gen3r/p1-review-report` (blocking / should-fix / nit, each with
   file:line + concrete failure scenario).
2. `twux send-message --session parent --status done --body "P1 review:
   <counts>. Branch ..., report ..."`
