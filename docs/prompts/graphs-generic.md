# Generic graphs — drop the authored/pad distinction + duplicate

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). Wave 1. Shares
`store.svelte.ts` (graph region) with `objects-crud` (effects/presets region — disjoint
methods) — keep additions localized.

## Locked decisions
1. **No authored/pad distinction.** Every graph is a first-class generic object — rename,
   delete, AND **duplicate** work on ANY graph key. `graphNames` holds a display name for
   **every** graph (pad keys included).
2. **Delete is real, no respawn.** Deleting a graph removes it; a pad whose graph is gone
   is simply **silent** until a graph with a matching drum trigger source exists again.
   (Hit-resolution is already by trigger source, so no per-pad regeneration is needed.)

## What this delivers
- `store.duplicateGraph(key)` — clone any graph under a fresh `graph-`/`nid('graph')` key,
  label `"<name> copy"`, select it; mirror `duplicateSong`/`duplicateSection`.
- `renameGraph`/`deleteGraph` lose the `isAuthoredGraphKey` guard — they work on **any**
  key (drop the `key in graphNames` AND `isAuthoredGraphKey` gating; keep "exists in
  `graphs`" sanity). `deleteGraph` still purges the key from every section across all songs.
- **Pad-label hydration:** in the graph-hydrate path (`normalizeGraphs`/seed), populate
  `graphNames` for pad keys with their friendly label (e.g. `"Kick · center"`) so renames
  start from a nice name and restored shows never show raw `kick:0` keys.
- **UI uniformity:** SectionsView graph rows + Inspector expose Rename / **Duplicate** /
  Delete for ALL graphs (no `isAuthoredGraphKey` branch). Add **Duplicate** to the graph
  context menu (calls `duplicateGraph`). "Remove from section" vs "Delete graph" still distinct.

## Scope
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — remove `isAuthoredGraphKey` guards in
  `renameGraph`/`deleteGraph`; add `duplicateGraph`; hydrate `graphNames` for pad keys.
  (`isAuthoredGraphKey` may be deleted if nothing else needs it — grep first; the recall
  reserve / show integrity uses a separate `graph:`/`graph-` check, leave that.)
- `apps/web/src/lib/app/views/SectionsView.svelte` — uniform row actions (Rename ·
  Duplicate · Delete graph · Remove from section) for every graph, not just authored.
- `apps/web/src/lib/app/docks/Inspector.svelte` — rename field shows for every graph;
  add Duplicate where the graph editor lives.
- Tests: `store.graphs.test.ts` — duplicate (any key, fresh key, "copy" label); rename +
  delete now work on pad keys; pad-label hydration; deleted graph leaves no dangling
  section refs + resolves to silence (no respawn).

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on the committed
tree. **Svelte MCP / svelte-file-editor mandatory** for `.svelte`.

## Acceptance
Any graph renames/deletes/duplicates uniformly; pad keys get friendly names; deleting a
pad's graph silences that pad (no respawn); no dangling section refs; full sweep green.
(Live `:5173` spot-check owed.)

## Report back
Parent `twux send-message --session parent` with commit SHA(s), the new/changed store API,
the hydration approach, gate totals, deviations. Commit before reporting; leave ROUTER to the orchestrator.
