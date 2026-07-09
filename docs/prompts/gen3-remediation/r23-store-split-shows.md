# R23 — Store split 4/5: extract the shows/setlist controller (#102)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`.
Spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md` Phase 4.5.

Extract the shows/setlist/songs concern from
`apps/web/src/lib/trigger-lab/store.svelte.ts` into a constructor-injected
controller, following the established recipe — read these first:
- R20 `controller-monitor.svelte.ts` + `docs/reports/2026-07-09-gen3-r20.md`
- R21 `midi-controller.svelte.ts` + `docs/reports/2026-07-09-gen3-r21.md`
- R22 `controller-test.svelte.ts` + `docs/reports/2026-07-10-gen3-r22.md`
  — its "Seam for R23 / R24" section maps YOUR cluster precisely:
  `showLibrary`, `activeShowId`, `shows`/`activeShow` deriveds,
  `songLibrary`/`songRefs`/`songs`/`activeSongId`,
  `resolvedSongs`/`songLibraryList`, the `libSync`/`songLibSync`
  server-library controllers, and `writeStoredLibrary`/
  `writeStoredSongLibrary` persistence. Show/song CRUD + library resolution.

Hard constraints:
- API-preserving: every existing store method/getter keeps its exact
  signature (thin delegators); existing tests pass UNMODIFIED.
- Do NOT touch the section-arrangement cluster (`activeSectionId`,
  `sections`, `sectionClipboard`, section fire path) — that is R24, which
  follows you in this file. Note in your report where its seam now sits.
- The sim play surface stays in the store (out of scope for the split).

Scoped tests during dev; full `pnpm gates` before reporting. Report:
`docs/reports/2026-07-10-gen3-r23.md` (committed). Then
`twux send-message --session parent --status done --body "R23: extracted <module>, store now <n> lines. Branch ..., report ..."`
