# Component pass S2.1 — Chrome adopts the shared primitives

PRD §S2.1. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **Depends on Wave B**
(S1.1 CommitInput, S1.2 EditableRow/ListItem, S1.4 StatusPill). **PR mapping:** the S2 adoption work; #3
(TopBar dead prop) already merged. Owns `lib/app/chrome/*` — disjoint from S2.2/S2.3.

**Blocked by:** S1.1, S1.2, S1.4 (the primitives it adopts).

## What this delivers
The app chrome stops hand-rolling rows / inline-rename / status pills and adopts the Wave-B primitives, so
the chrome's look & feel is editable in one place.

## Scope (`apps/web/src/lib/app/chrome/`)
- `LeftRail.svelte` — `.navitem` rows → `lib/ui/ListItem` (icon + label, active state).
- `SongRail.svelte` — song rows → `lib/ui/EditableRow` (inline rename + ContextMenu Rename/Duplicate/Delete);
  drop the bespoke `<input>`+rAF rename and `.item` styling.
- `ShowBrowser.svelte` — show rows → `EditableRow`; the New/Save/Save-As/Close action buttons → `IconButton`
  / a button primitive; keep the Dialog wrapper.
- `TopBar.svelte` — the show-name inline rename already uses CommitInput; align it to the consolidated
  `lib/ui/CommitInput` (S1.1). (`shell` prop already removed by #3.)
- `Transport.svelte` — hand-rolled `<label>`+Slider field rows → `lib/ui/Field`; `.tap`/`.panic` bare
  buttons → `IconButton`.
- `OutputPill.svelte` (+ `SaveIndicator.svelte`) → render on `lib/ui/StatusPill` (S1.4). If SaveIndicator's
  spinner→check cross-fade doesn't fit the pill, keep that bespoke and only adopt the dot/label shell (per
  S1.4's note).

## Tests
- Keep existing chrome behaviour green; add/extend tests only where a row's rename/delete wiring changed.
  Visual parity is the goal — no behaviour change.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only;
no new hardcodes (any you'd add, use tokens — S4.1 will not revisit chrome).

## Acceptance
Chrome rows/rename/pills all flow through `lib/ui` primitives; visual parity with today; rename/delete/CRUD
still work; full sweep green. (Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent (orchestrator) with commit SHA, files changed, primitives adopted per file, gate totals,
deviations + the owed spot-check. Leave ROUTER to the orchestrator.
