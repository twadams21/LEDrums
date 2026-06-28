# CRUD — Section rename + delete

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`
(worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER `ctx-menu-primitive` is
merged** (you surface verbs via `lib/ui/ContextMenu.svelte`). Shares `SectionsView.svelte`
with `crud-graph` — keep your edits localized to the **section header / section column
chrome** (crud-graph owns the graph-row chrome).

## What this delivers
A performer can **rename** and **delete** a section. These join the existing
add/copy/paste/duplicate, surfaced consistently via a right-click context menu on the
section header (plus inline rename).

## Scope
- `apps/web/src/lib/app/setlist.ts` — add a pure **`removeSection(song, sectionId): Song`**
  (mirror `addSection`; immutable; drop the section, no-op if absent). `renameSection`
  already exists here (line ~80) — reuse it, don't duplicate.
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — add store mutators
  **`removeSection(sectionId)`** and **`renameSection(sectionId, name)`** via the existing
  `updateActiveSong(...)` pattern (place them beside `addSongSection`/`copySection`/
  `pasteSection`/`duplicateSection`, ~lines 800–835, to keep the merge clean). On
  removing the active section, pick a sensible new `activeSectionId` (e.g. previous/first
  remaining, or none if empty). Both persist via the existing autosave path.
- `apps/web/src/lib/app/views/SectionsView.svelte` — (a) **inline rename**: make the
  section name an editable `CommitInput` (reuse `lib/ui/CommitInput.svelte`) on the
  section header; (b) **context menu**: wrap the section header with
  `lib/ui/ContextMenu.svelte` exposing **Rename · Duplicate · Delete** (Delete = `danger`;
  Duplicate calls the existing `duplicateSection`; Rename focuses the inline input). Keep
  the existing copy/paste hover IconButtons or fold them into the menu — your call, but
  Delete MUST be reachable.

## Tests
- `setlist.test.ts` — `removeSection` (drops the right section, immutable, no-op on
  unknown id; order of the rest preserved).
- store tests — `renameSection` updates the name + persists; `removeSection` drops it +
  re-points `activeSectionId` sensibly + persists.

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on your
committed clean tree. **Svelte MCP / svelte-file-editor mandatory** for `.svelte`. Reuse
`lib/ui/` primitives + tokens.

## Acceptance
- Sections can be renamed (inline) and deleted (context menu, danger); duplicate/copy/paste
  still work; active-section re-points correctly after delete; persists across reload;
  full sweep green. (Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent with commit SHA(s), files, the new store/`setlist` API, gate totals,
deviations. Commit before reporting; leave ROUTER to the orchestrator.
