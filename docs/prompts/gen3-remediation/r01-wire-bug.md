# R01 — Diagnose + fix the vanishing/reappearing wire bug (GH #80)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 80 -R twadams21/LEDrums`, then the parent spec's Phase 1.4
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

This is a diagnosis-first ticket — use the `/diagnose` skill. A user-drawn
wire either exists or fails visibly; today it can silently vanish and
reappear after refresh. Find the root cause before writing the fix:
candidate mechanisms include a duplicate edge the projection didn't render,
a rejected add masked by refresh-time auto-wiring, or projection-cache
reuse dropping the edge. Relevant prior art:

- `apps/web/src/lib/app/views/TriggerGraphView.svelte` + `trigger-flow-projection` (signature-based node/edge reuse; see `.mex/ROUTER.md` entries "Remote trigger-graph sync hardening" and "Trigger graph position persistence")
- store connect/reconnect path in `apps/web/src/lib/trigger-lab/store/`
- hydrate sanitizer (`hydrate.integrity.test.ts` prior art) which drops duplicate/dangling edges silently

State the root cause explicitly in your report and closing commit. This
ticket gates the whole wiring chain (R03/R04/R08) — correctness beats speed.

Acceptance criteria are on the issue. Note: if refresh-time normalisation
remains, surface it (the system-action toast ticket R02 runs in parallel —
don't build toast UI yourself; leave a clean seam/TODO noting the event).
