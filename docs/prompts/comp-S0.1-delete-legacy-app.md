# Component pass S0.1 — Delete the dead legacy app

PRD: `docs/plans/2026-06-27-componentisation-prd.md` (§S0.1). Overlay: `docs/plans/2026-06-27-pr-overlay-direction.md`.
Branch base `feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). **PR mapping:** PRD
finding (no PR). **Independent — touches only confirmed-dead files; run in its own worktree, first.**

## What this delivers
Removes the entire superseded legacy control app. A static reachability crawl from all three real
entries (`App.svelte`, `?style`, `?proto=trigger`) found these unreachable; each was re-confirmed by a
basename grep returning only itself + other dead files. ~28 files, ~4,365 lines gone, gates still green.

## Scope — delete these files (and any now-orphaned imports)
**Legacy shell + store + panels + old views + routing (25 files):**
- `apps/web/src/lib/shell/` — AuthorShell.svelte, SettingsView.svelte, StatusCluster.svelte, LivePill.svelte, Icon.svelte
- `apps/web/src/lib/store/app-store.svelte.ts`
- `apps/web/src/lib/panels/` — ClipGrid, EffectParams, InputMonitor, KitEditor, LayerStack, ModulationMatrix, OutputConfig, ProjectBar, StatusBar, Transport (`.svelte`) + `params.ts` + `params.test.ts`
- `apps/web/src/lib/routing/build-routing-graph.ts`
- `apps/web/src/lib/views/` — ArrangeView.svelte, MapView.svelte, PerformView.svelte, RoutingView.svelte, arrange-helpers.ts, arrange-helpers.test.ts
**Unused `lib/ui` primitives (3 files):** `Card.svelte`, `Rail.svelte`, `Sidebar.svelte`.

NB the LIVE app has its OWN `Transport`/`StatusBar`/`PerformView` under `lib/app/` + `lib/trigger-lab/` — do
**not** touch those. Delete only the `lib/panels/` and `lib/views/` copies named above.

## Method
- For each target, `git grep "<Basename>"` first; confirm every hit is within the delete set (or its own
  test) before removing. If any LIVE-APP file imports it, STOP and flag — do not delete.
- After deletion, `pnpm --filter web typecheck` must be 0 (catches any missed import). Remove the empty
  `lib/shell/`, `lib/panels/`, `lib/routing/`, `lib/views/`, `lib/store/` dirs if fully emptied.
- *Salvage:* `lib/panels/params.ts` has pure `throttle`/`tapTempo` — **do not port** (no live caller); delete.

## Gate discipline
Full `pnpm typecheck && pnpm test` on your committed clean tree (expect the same pass count minus the 2
deleted test files' cases). No `.svelte` editing needed beyond deletes.

## Acceptance
All 28 files gone; no dangling imports; typecheck 0; test suite green (only the 2 dead test files removed).

## Report back
Report to parent (orchestrator) with commit SHA, the file list deleted, line count removed, gate totals,
any file you refused to delete (with the grep that saved it). Leave ROUTER to the orchestrator.
