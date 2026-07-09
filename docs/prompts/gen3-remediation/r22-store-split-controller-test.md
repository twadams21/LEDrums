# R22 — Store split 3/5: extract the controller-test controller (#101)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`.
Spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md` Phase 4.5.

Extract controller-test concerns (test-pattern playback / controller test
state) from `apps/web/src/lib/trigger-lab/store.svelte.ts` into a
constructor-injected controller module, following EXACTLY the pattern set by
the two prior slices:
- R20: `apps/web/src/lib/trigger-lab/controller-monitor.svelte.ts`
  (report `docs/reports/2026-07-09-gen3-r20.md`)
- R21: `apps/web/src/lib/trigger-lab/midi-controller.svelte.ts`
  (report `docs/reports/2026-07-09-gen3-r21.md`)
Read both reports first — they document the extraction recipe (rune ownership,
constructor injection, delegate getters keeping the store API identical).

Hard constraints:
- API-preserving: every existing store method/getter keeps its exact
  signature; existing tests pass UNMODIFIED (moving a test file wholesale to
  sit next to the new module is fine; editing assertions is not).
- Same-file chain: R23 (shows/setlist) and R24 (section-arrangement) follow
  you in this file — keep the extraction seam clean and note in your report
  where their concerns start/end in the remaining store.

Scoped tests during dev; full `pnpm gates` before reporting. Report:
`docs/reports/2026-07-10-gen3-r22.md` (committed). Then
`twux send-message --session parent --status done --body "R22: extracted <module>, store now <n> lines. Branch ..., report ..."`
