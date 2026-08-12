# S2 — Tabbed shell rebuild

**Parent plan:** `docs/plans/2026-08-13-tabbed-chrome-settings.md` (read it first — decisions
header + target layout + decided open questions). **Base:** branch off `origin/main`; expected
tip ancestry includes `10b1b46` (PR #174 — DM Sans + dev --share). Open with:

```
git fetch origin && git checkout -b feat/tabbed-shell origin/main
git log --oneline -3   # confirm 10b1b46 in history; if absent, STOP and report
```

## Goal

Replace the left-rail shell with the tabbed chrome (prototype variant C), properly rebuilt —
the prototype (`apps/web/src/lib/app/proto-chrome/ProtoShell.svelte`) is reference material,
not code to copy: it skipped tests, dropped the project menu, and used throwaway markup.

Target rows:
1. **Nav bar:** brand · view tabs (Perform · Objects · Sections · Trigger Graph · Monitor — no
   Patch tab) · show identity (show name + SaveIndicator + project menu = today's ShowBrowser
   affordances: new/open/save/save-as/rename/delete) · **Share** · presence/takeover · Backups ·
   UpdateBadge · Settings gear.
2. **Setlist songs bar** (sticky).
3. **Sections bar** (sticky).
4. **Full-width workspace** (the active view). Keep the existing right column (`col2`,
   Visualizer + Buses/Layers) exactly where it is for now — S5 re-homes it; do NOT delete it.
5. **Bottom bar:** Transport · StatusBar · OutputPill — **read-only stats only** (decided:
   presence/takeover lives in the top bar, not here).

## Also in scope: Settings modal shell

Settings becomes a large sectioned modal (see prototype `ProtoSettingsC.svelte` for the shape):
left section list, content pane, deep-linked via `?settings=<pane>`. S2 builds the **shell +
routing only**: today's app-settings content (`chrome/AppSettingsDialog.svelte`) becomes the
first section(s); empty registry slots for the S4 panes (Input · Drums & Hoops · Outputs &
Chains · Controller · System) that later slices fill with their own component files.
`?view=patch` (old URLs) must resolve to opening this modal, not a 404/blank view.

## shell-nav changes (unit-tested, lockstep with tests)

- `apps/web/src/lib/app/shell-nav.ts:12` — drop `'patch'` from `View`; update `VIEWS` (line 34).
- Map incoming `?view=patch` → open Settings (deep-link) — a redirect, not a crash.
- Update `shot-seam.ts` `view:` op, ui-shot presets (`scripts/ui-shot/`), and every
  `shell-nav.test.ts` case that enumerates views.

## Anchors to verify before building

- `apps/web/src/lib/app/AuthorShell.svelte` — current shell (rows/columns, dock mounts).
- `apps/web/src/lib/app/chrome/` — TopBar, LeftRail, SongRail, Transport, ShowBrowser,
  SaveIndicator, ShareInfo, OutputPill, UpdateBadge, BackupsDialog, AppSettingsDialog,
  PinGate, BootOverlay. Reuse these components; re-arrange, don't rewrite, unless the new
  layout genuinely requires it.
- `apps/web/src/lib/app/proto-chrome/ProtoShell.svelte` + `ProtoSettingsC.svelte` — the look
  Trent approved (variant C). Match its visual intent on real components.
- `apps/web/src/lib/app/shell-store.svelte.ts` — presence/takeover + save state live here.

## Scope fence

May mutate: `AuthorShell.svelte`, `shell-nav.ts` + test, `shot-seam.ts`, `chrome/*`
(including deleting `LeftRail.svelte`; `SongRail.svelte` stays if still referenced by
Objects/library, dies if unreferenced), the new Settings modal component(s), ui-shot presets,
`apps/web/src/lib/styleguide/` entries + regenerated `docs/design-system.html`.

Non-goals (do NOT touch): `views/*` internals (PatchGraphView stays alive and routable via
nothing — that's fine, S6 deletes it), `docks/*` (right column stays), any engine/protocol
code, `proto-chrome/*` (S7 deletes it). Crossing the fence obliges pasting the diff in your
report.

## Non-negotiables (AGENTS.md binds you)

- Compose from `docs/design-system.html`; anything new + reusable (tab bar, chip bar, settings
  modal shell) gets a styleguide entry + `pnpm design-system` regen **in the same change**.
- Apply `/make-interfaces-feel-better` (polish pass) and the `/efficient-svelte` discipline.
- Verify with `pnpm ui-shot` captures of every touched surface. The dev port is your worktree
  pool port (`twux worktree port`) — set `UI_SHOT_BASE` accordingly, never assume :5173.
- `pnpm test` + `pnpm typecheck` green on committed HEAD before push.

## Evidence + report

Effort: **high** (novel seam — shell rebuild). One PR into `main` when done (branch pushed via
`twux push`; open the PR with `gh`). Commit body = the report (<30 lines): what shipped,
files touched, test-count delta, ui-shot names, deviations. Completion message to your parent
via SendMessage: one line — commit sha, branch, PR number, gates status.

## Escalation triggers (stop and SendMessage the orchestrator)

- The Settings-modal pane registry can't stay file-disjoint from S4 panes.
- ShowBrowser affordances don't survive the move into the nav bar without redesign.
- Any conflict with an AGENTS.md non-negotiable.
- `?view=patch` redirect can't work without touching `views/*`.
