# R24 — Store split 5/5: extract the section-arrangement controller (#103)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`.
Spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md` Phase 4.5.
This is the FINAL slice of the god-file split.

Extract the section-arrangement concern from
`apps/web/src/lib/trigger-lab/store.svelte.ts` into a constructor-injected
controller, following the established recipe — read these first:
- R20 `controller-monitor.svelte.ts`, R21 `midi-controller.svelte.ts`,
  R22 `controller-test.svelte.ts`, R23 `shows-controller.svelte.ts`
  (+ reports `docs/reports/2026-07-{09,10}-gen3-r2{0,1,2,3}.md`).
- R23's report maps YOUR seam precisely: `activeSectionId`,
  `sectionClipboard`, `sections`/`activeSection` deriveds, and section CRUD
  stay in the store today, reading songs via the R23 delegators — that
  cluster is what you extract.

Hard constraints:
- API-preserving: every existing store method/getter keeps its exact
  signature (thin delegators); existing tests pass UNMODIFIED.
- The section fire path (`fireSectionGraph`) and the sim play surface stay
  in the store — the split extracts the arrangement/authoring model, not
  the play surface.
- Read songs through the R23 `ShowsController` delegators (injected host),
  not by reaching into the controller directly.
- After extraction, note the final store line count and what concerns
  remain in it (this closes spec 4.5 — the report is the split's capstone).

Scoped tests during dev; full `pnpm gates` before reporting. Report:
`docs/reports/2026-07-10-gen3-r24.md` (committed). Then
`twux send-message --session parent --status done --body "R24: extracted <module>, store now <n> lines, split 5/5 complete. Branch ..., report ..."`
