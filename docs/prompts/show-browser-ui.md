# Show browser UI + TopBar active-show title

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`
(worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER `show-document-model`
(store API), `ctx-menu-primitive`, AND `shell-demode-perform` are merged** — it consumes
the show store API + ContextMenu, and edits `TopBar.svelte` which the shell slice already
de-ModeSwitched.

## What this delivers
The UI for the show document lifecycle: the active show's **name is visible + editable in
the top bar**, and a **show browser** exposes New / Open / Save / Save-As / Close / Rename /
Delete over the saved shows.

## Scope
- `apps/web/src/lib/app/chrome/TopBar.svelte` — show the **active show name** (from
  `store.activeShow`) as an editable in-place `CommitInput` (`lib/ui/CommitInput.svelte`)
  → `store.renameShow(activeShowId, name)`. Place it where the document identity belongs
  (left of/with the setlist area). Keep the edit localized — the shell slice already
  removed ModeSwitch here.
- A **show browser** — reuse `lib/ui/Dialog.svelte`. Trigger it from a "Shows" / file-menu
  affordance in the TopBar. Contents:
  - **New** (`store.newShow`), **Save** (`store.saveShow`), **Save As…**
    (`store.saveShowAs(name)` — prompt for a name via a `CommitInput`/field), **Close**
    (`store.closeShow`).
  - A **list of saved shows** (`store.shows`): click a row to **Open** (`store.openShow`),
    with the active show marked. Each row wraps `lib/ui/ContextMenu.svelte` exposing
    **Rename** (inline `CommitInput` → `renameShow`) and **Delete** (`danger` →
    `deleteShow`).
- Keep all behavior driven through the `show-document-model` store API — **no new
  persistence logic here**.

## Tests
- Light — this is UI over a tested store API. Verify typecheck + svelte-check + autofixer.
  If a small pure helper sneaks in (e.g. sorting/formatting shows for display), unit-test
  that. No heavy component tests.

## Gate discipline
Full `pnpm typecheck && pnpm test` on your committed clean tree. **Svelte MCP /
svelte-file-editor mandatory** for `.svelte`. Reuse `lib/ui/` primitives + tokens
(Dialog/ContextMenu/CommitInput/IconButton).

## Acceptance
- TopBar shows + edits the active show name; a show browser does New/Open/Save/Save-As/
  Close + per-show Rename/Delete via context menu; all via the show store API; full sweep
  green. (Live `:5173` spot-check of the full show lifecycle owed — flag it.)

## Report back
Report to parent with commit SHA(s), files, how the browser is composed, gate totals,
deviations. Commit before reporting; leave ROUTER to the orchestrator.
