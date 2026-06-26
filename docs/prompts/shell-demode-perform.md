# Shell de-mode + Kit→Perform view

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`;
you run in a worktree — read `docs/prompts/_worktree-note.md`. **This slice is
file-disjoint from all CRUD/store work** (it touches `app/` shell + chrome + views, not
the store/setlist/persistence), so it runs in parallel with the CRUD slices. It is
**cohesive — one agent owns the whole shell change** (the reducer change and its tests
must move together).

## What this delivers
One mode-less unified shell. The **Perform/Author mode toggle is removed entirely** —
"Author" stops being a mode; the app is simply whichever **view** is selected. The view
rail becomes **Trigger · Patch · Sections · Perform**. The **Kit view is removed**.
**Perform becomes a workspace view** that hides the editing chrome (Layers/Buses drawer +
right Inspector dock) and shows the 3D/2D visualizers + pad grid + section recall strip
for a focused performance layout.

## Locked decisions
1. `Mode` is deleted from the model (not hidden) — `shell-nav.ts` no longer has a mode.
2. `View` member `kit` → `perform`; rail order `trigger · patch · sections · perform`.
3. Perform is a **view**, not a shell — it plugs into the one unified shell's center, and
   the shell conditionally hides the left drawer + right dock when `view === 'perform'`.
4. The 3D/2D visualizer + pads remain reachable in Perform (mined from the old
   `PerformShell`).

## Scope (touch-points — verified against the current tree)
- `apps/web/src/lib/app/shell-nav.ts` — **drop** `Mode` type, `MODES`, `setMode`, the
  `mode` field on the nav state, and mode parsing + `MODE_ALIASES` in `parseSearch`.
  Rename `View` `kit`→`perform`; update `VIEWS`. `initialNav` no longer takes/sets a mode.
  Keep `setView` (retype to the new `View`).
- `apps/web/src/lib/app/shell-nav.test.ts` — **lockstep**: remove `setMode` import +
  tests, the legacy mode-alias `parseSearch` tests, and `mode` from `initialNav`
  assertions; `parseSearch('?view=kit')` expectation → `perform` (or drop, your call);
  add/adjust so `VIEWS` includes `perform` not `kit`. This file is the seam — it must stay
  green in the SAME commit as the reducer change.
- `apps/web/src/lib/app/shell-store.svelte.ts` — remove the `Mode` re-export, the `mode`
  getter, and the `setMode` method.
- `apps/web/src/App.svelte` — remove the `{#key shell.mode}` crossfade and the
  `PerformShell` import/branch; render the single unified shell directly.
- `apps/web/src/lib/app/AuthorShell.svelte` — becomes the **unified shell**. When
  `shell.view === 'perform'`: (a) render the new `PerformView` in the center instead of
  the view-router's editors, (b) **hide** the Layers/Buses drawer and the right
  Inspector/Monitor dock (conditional render + collapse the grid columns accordingly).
  Otherwise unchanged. (Consider renaming the file to `Shell.svelte` only if cheap —
  optional; not required.)
- `apps/web/src/lib/app/chrome/ModeSwitch.svelte` — **delete**.
- `apps/web/src/lib/app/chrome/TopBar.svelte` — remove the `ModeSwitch` import + render.
  **NB:** a sibling slice (`show-browser-ui`) will later add a show-title here; keep your
  edit minimal (just the ModeSwitch removal) to localize overlap.
- `apps/web/src/lib/app/chrome/LeftRail.svelte` — NAV: replace the `kit` entry with
  `{ id: 'perform', label: 'Perform', icon: <pick a lucide icon e.g. Play/Radio/Monitor> }`.
- `apps/web/src/lib/app/views/KitView.svelte` — **delete** (its 3D content is subsumed by
  PerformView/Patch).
- `apps/web/src/lib/app/views/PerformView.svelte` — **new**. Mine from the old
  `PerformShell` (see below): 3D + 2D `Visualizer` (split, `Splitter`), the **pad grid**
  (`drumPads` + `firePad`), and the **section recall strip**. Props `{ store, shell }`.
  Reuse the existing pane-size keys (they're already namespaced for perform — verify no
  collision with author panes).
- The old Perform shell: `apps/web/src/lib/app/PerformShell.svelte` is the one `App.svelte`
  imports — mine its content into `PerformView`, then **delete** it. There is also
  `apps/web/src/lib/shell/PerformShell.svelte` (older/likely dead) — check references; if
  unreferenced after this change, delete it too (don't leave two).

## Tests
- `shell-nav.test.ts` updated and green (no `Mode`; `View` has `perform`; `parseSearch`
  no mode). This is the only unit-tested file in scope; the rest is verified by typecheck +
  svelte-check + autofixer.

## Gate discipline
- `pnpm --filter @ledrums/web typecheck` + the `shell-nav` tests during work; full
  `pnpm typecheck && pnpm test` on your committed clean tree. **Svelte MCP /
  svelte-file-editor mandatory** for every `.svelte`. Grep the repo for any lingering
  `shell.mode` / `setMode` / `ModeSwitch` / `KitView` / `'kit'`-as-view references and
  clean them (e.g. `?proto=` lab, OutputPill, StatusBar) so typecheck is 0.

## Acceptance
- No `Mode` anywhere in `app/`; rail is Trigger·Patch·Sections·Perform; Kit gone;
  Perform view hides drawer + right dock and shows visualizers + pads + recall; deep-link
  `?view=…` still works; `shell-nav.test.ts` + full sweep green. (Live `:5173` spot-check
  of the Perform layout + view switching owed — flag it.)

## Report back
Report to parent with commit SHA(s), files changed/deleted/created, the final `shell-nav`
shape, how PerformView was composed, gate totals, and any deviation. Commit before
reporting; leave ROUTER to the orchestrator.
