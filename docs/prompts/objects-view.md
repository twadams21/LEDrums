# Objects view + view reorder (Perform · Objects · Sections · Trigger · Patch)

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER
`graphs-generic` + `objects-crud` are merged** (it consumes their CRUD surface). Mostly
disjoint from the persistence/recall slices (shell-nav + LeftRail + a new view file).

## What this delivers
- A new **`objects`** view — a master-detail index of authored objects.
  - **Left:** a list of object **types** — Songs · Effects · Graphs · Presets (styled like
    the Sections-view graph rail).
  - **Right:** the list of objects of the selected type, each row showing name (+ a small
    detail, e.g. preset usage count), with **view/edit/rename/duplicate/delete** via the
    `lib/ui/ContextMenu` primitive, wired to the existing store CRUD.
- **View reorder:** the rail becomes **Perform · Objects · Sections · Trigger · Patch**.

## CRUD per type (use the existing store API; respect the sign-off)
- **Songs:** rename / duplicate / delete (exist). Selecting one can activate it.
- **Graphs:** rename / duplicate / delete (exist after `graphs-generic`). Open one → its editor.
- **Effects:** rename / duplicate (exist after `objects-crud`). **No delete** (disabled/absent).
- **Presets:** rename / duplicate (exist); **delete only when `presetUsageCount(id) === 0`**
  (disable Delete + show usage when in use). No create-from-scratch (duplicate covers it).

## Scope
- `apps/web/src/lib/app/shell-nav.ts` — add `'objects'` to the `View` union + `VIEWS`, in
  the order **`['perform','objects','sections','trigger','patch']`**. `parseSearch` round-trips it.
- `apps/web/src/lib/app/shell-nav.test.ts` — update VIEWS order + `?view=objects`.
- `apps/web/src/lib/app/chrome/LeftRail.svelte` — NAV in the new order with an Objects item
  (pick a lucide icon, e.g. `LayoutList`/`Boxes`).
- `apps/web/src/lib/app/views/ObjectsView.svelte` — **new** master-detail view (type rail +
  object list + per-row ContextMenu actions). Props `{ store, shell }`. Reuse
  `lib/ui/` primitives + tokens; mirror the Sections-view rail/list layout for consistency.
- `apps/web/src/lib/app/AuthorShell.svelte` — render `ObjectsView` when `view === 'objects'`
  (a normal editor view: keeps the drawer + dock, unlike Perform).
- Tests: shell-nav (VIEWS order + objects round-trip). The view itself is UI over tested
  CRUD — verify typecheck + svelte-check + autofixer; unit-test any pure list/sort helper.

## Gate discipline
Per-package typecheck/test; full sweep on the committed tree. **Svelte MCP** for `.svelte`.
Reuse `lib/ui/` (ContextMenu/CommitInput/IconButton/Dialog) + tokens.

## Acceptance
Rail order is Perform·Objects·Sections·Trigger·Patch; Objects view lists Songs/Effects/
Graphs/Presets and does the per-type CRUD (effects no-delete; presets delete-only-when-
unused); `?view=objects` deep-links; full sweep green. (Live `:5173` spot-check owed.)

## Report back
Parent with commit SHA(s), the new view composition, gate totals, deviations. Commit before
reporting; ROUTER to orchestrator.
