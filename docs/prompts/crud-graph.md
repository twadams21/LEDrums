# CRUD — Authored graph rename (store wrapper) + delete

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`
(worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER `ctx-menu-primitive` AND
`crud-section` are merged** — you also edit `SectionsView.svelte` (graph-row chrome; crud-
section owns the section-header chrome) so going after it keeps the merge clean.

## What this delivers
Authored graphs become fully manageable: **rename** goes through a real store mutator
(today the trigger Inspector mutates `store.graphNames` directly — no autosave-consistent
wrapper), and **delete** an authored graph removes it everywhere (orphan cleanup). Pad/kit
graphs stay non-renamable / non-deletable (they derive from the kit).

## Locked decisions
1. Only **authored** graphs (keyed `graph:`/`graph-` — see `isAuthoredGraphKey`) are
   renamable/deletable. Pad graphs reject both.
2. `deleteGraph` purges the graph from `graphs` + `graphNames` **and** from every section's
   `graphs` list across **all** songs (no dangling references left behind).

## Scope
- `apps/web/src/lib/trigger-lab/store.svelte.ts` —
  **`renameGraph(key, name)`**: guard to authored keys; update `graphNames`; persist.
  **`deleteGraph(key)`**: guard to authored keys; delete from `graphs` + `graphNames`;
  remove from every `song.sections[*].graphs` (reuse `setlist.removeGraph` per section, or
  a sweep); if the deleted graph was selected/open, clear/re-point `selectedPadKey`;
  persist. Place beside `createGraph` (~line 840).
- `apps/web/src/lib/app/docks/Inspector.svelte` — replace the **direct** `store.graphNames`
  mutation (the authored-graph rename field, ~lines 237–240 / 354–363) with a call to the
  new `store.renameGraph(...)`. Behavior identical, now autosave-consistent.
- `apps/web/src/lib/app/views/SectionsView.svelte` — on authored-graph rows (the graph
  list), add a **delete** affordance via `lib/ui/ContextMenu.svelte` (**Remove from
  section** vs **Delete graph** — distinguish: "Remove from section" =
  `removeGraphFromSection` (exists); "Delete graph" = the new `deleteGraph`, `danger`).
  Rename of an authored graph can also be offered here (calls `renameGraph`). Touch only
  the graph-row chrome — leave section-header chrome to `crud-section`.

## Tests
- store tests — `renameGraph` renames authored graphs + persists, **no-ops/throws on pad
  graphs**; `deleteGraph` removes from `graphs`/`graphNames` + every section across songs +
  clears selection if open + persists.

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on your
committed clean tree. **Svelte MCP / svelte-file-editor mandatory** for `.svelte`.

## Acceptance
- Authored graphs rename via `store.renameGraph` (Inspector no longer mutates directly) and
  delete via `store.deleteGraph` with full section purge; pad graphs reject both; persists;
  full sweep green. (Live `:5173` spot-check owed.)

## Report back
Report to parent with commit SHA(s), files, the new store API, gate totals, deviations.
Commit before reporting; leave ROUTER to the orchestrator.
