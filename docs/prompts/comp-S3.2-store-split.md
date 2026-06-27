# Component pass S3.2 — Split the TriggerLab store into domain slices

PRD §S3.2. Overlay PRs **#7** (split store), **#21** (show-library sync controller — sub-slice), **#12**
(domain ID factory — optional), **#13** (legacy-sections cleanup — RESCOPED). Branch base
`feat/unified-shell` (worktree — read `_worktree-note.md`). **Independent worktree — API-preserving.**

**Blocked by:** none — can start immediately (own worktree; owns all of `store.svelte.ts`, incl. the
`makeBlock` removal folded in from S0.3).

## What this delivers
`store.svelte.ts` (1888) — a god-store — becomes a thin reactive `TriggerLab` rune wrapper delegating to
~10 pure reducer slices, each guarded by its existing `store.*.test.ts`. **The public `TriggerLab` class API
is unchanged, so no UI file changes** — this is internal structure only. **Keep the store under
`lib/trigger-lab/`** (PR #6's move is dropped).

## Scope (`apps/web/src/lib/trigger-lab/`)
- Extract pure reducer modules under `store/` along the existing test seams (each ~100–210 lines):
  `shows` · `songs` · `sections` · `graphs` · `objects` · `value-switch` · `trigger-routing` ·
  `server-library` · `persistence` · `transport`/engine-link. Pattern = pure functions
  (`fn(state, …) → newState`) + the rune wrapper calls them (mirror `setlist.ts`/`shell-nav.ts`).
- `store.svelte.ts` keeps the `TriggerLab` class + runes, delegating each domain to its slice. Public method
  names/signatures preserved exactly.
- **#21 sub-slice:** extract the show-library reconcile/adopt/sync/saveStatus logic into a
  `store/show-library-sync.ts` controller (the server-authoritative-shows write-through path), consumed by
  the wrapper. Keep `save-status.ts` behaviour.
- **#12 (optional):** if it keeps the diff clean, centralize the scattered `nid()`/id generation into one
  `store/ids.ts` (8 domains use ad-hoc ids). Skip if it bloats the slice — note your choice.
- **Dead export (folded from S0.3):** remove the unused exported **`makeBlock`** (`store.svelte.ts:108`,
  no caller — grep-confirm) as part of the split, so all `store.svelte.ts` edits live in this one slice.
- **#13 (RESCOPED — careful):** `store.sections` is **LIVE, not dead** (the #13 PR's premise is wrong).
  Only remove legacy section state AFTER grep-confirming every caller has migrated to the flat-graph (U4)
  model. If any live caller remains, leave it and note what blocks removal. **Do not break the app.**

## Tests
- ALL `store.*.test.ts` (sections/songs/shows/objects/graphs/routing/persistence/server-library/value-switch/
  trigger-source) must stay green **untouched** — they are the contract. New slice-level unit tests welcome.

## Gate discipline
Per-package typecheck/test; full sweep on commit. The full `pnpm test` web count must not drop (behaviour
preserved). Pure TS slices; `.svelte.ts` wrapper via normal tooling.

## Acceptance
`TriggerLab` public API identical; ~10 pure slices + thin wrapper; #21 sync controller extracted; #13
handled safely (removed only if all callers migrated, else documented); all store tests green; full sweep
green. Closes #7/#21 (and #12 if taken). 

## Report back
Report to parent (orchestrator) with commit SHA, the slice list + sizes, the #13 disposition (removed vs
blocked-by), whether #12 was taken, gate totals, deviations. Leave ROUTER to the orchestrator.
