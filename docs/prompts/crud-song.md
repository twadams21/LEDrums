# CRUD — Song create + rename + delete

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`
(worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER `ctx-menu-primitive` is
merged.** File-disjoint from the other CRUD slices (you own `SongRail.svelte`; shared
`store.svelte.ts` additions are localized).

## What this delivers
A performer can **add a new song**, **rename** a song, and **delete** a song — today only
`setActiveSong` (select) exists. Surfaced via an add control on the SongRail + a
right-click context menu per song row.

## Scope
- `apps/web/src/lib/app/setlist.ts` — add a pure **`makeSong(id, name, sections?): Song`**
  helper (a fresh song; default it with one empty section if that matches how seeded songs
  look — check the existing seed). Optional: pure rename/remove over a song are trivial
  array ops and may live in the store instead — your judgment; prefer a pure helper if it
  mirrors `makeSection`.
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — add store mutators
  **`createSong(name?)`** (append to `songs`, generate id, make it active, return id),
  **`renameSong(id, name)`**, **`removeSong(id)`** (drop from `songs`; if it was active,
  re-point `activeSongId` to a sensible remaining song or none; guard against deleting the
  last song if that would break the app — your call, but don't crash). Place beside
  `setActiveSong` (~line 774). All persist via the existing autosave.
- `apps/web/src/lib/app/chrome/SongRail.svelte` — (a) an **add-song** control (a `+`
  `IconButton` in the rail header) → `store.createSong()`; (b) wrap each song row in
  `lib/ui/ContextMenu.svelte` exposing **Rename · Duplicate · Delete** (Delete = `danger`;
  Rename via inline `CommitInput` or a prompt — prefer inline `CommitInput`; Duplicate is
  optional, include if cheap). Selecting a row still calls `setActiveSong`.

## Tests
- store tests — `createSong` appends + activates + persists; `renameSong` updates name +
  persists; `removeSong` drops it, re-points `activeSongId`, persists; deleting the active
  song behaves sanely.
- `setlist.test.ts` — `makeSong` shape (if you add the helper).

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on your
committed clean tree. **Svelte MCP / svelte-file-editor mandatory** for `.svelte`.

## Acceptance
- Songs can be added, renamed, and deleted; selection still works; active-song re-points
  after delete; persists across reload; full sweep green. (Live `:5173` spot-check owed.)

## Report back
Report to parent with commit SHA(s), files, the new store/`setlist` API, gate totals,
deviations. Commit before reporting; leave ROUTER to the orchestrator.
