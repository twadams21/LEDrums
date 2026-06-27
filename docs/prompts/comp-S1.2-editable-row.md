# Component pass S1.2 — EditableRow / ListItem primitives

PRD §S1.2. Overlay PR **#14** (the **highest-impact duplication** — ≥5 files). Branch base
`feat/unified-shell` (worktree — read `_worktree-note.md`). **Foundation slice; prioritize — the adoption
slices (S2.1, S2.2) depend on it.** This slice ONLY creates the primitives + tests; adoption is separate.

**Blocked by:** none — can start immediately (uses S1.1's CommitInput if merged; else the existing one).

## What this delivers
The single most-repeated UI pattern as shared `lib/ui` components: a selectable list row with icon +
label/sub + hover-revealed actions + active/hover states, and an editable variant adding inline-rename +
right-click context menu. Today this is hand-rolled in LeftRail (`.navitem`), SongRail (`.item`),
ShowBrowser (`.row`), SectionsView, and ObjectsView — all the same flex row, `--accent-soft` active bg,
`--accent` border, gap/padding tokens.

## Scope (new files only)
- `apps/web/src/lib/ui/ListItem.svelte` — props: `icon?`, `label`, `secondary?`, `active?`, `onclick?`, an
  `actions` snippet (hover-revealed), `disabled?`. Encapsulate the active/hover token styling exactly as the
  current rows render it (so adoption is visually identical). Square corners per `--radius-card`.
- `apps/web/src/lib/ui/EditableRow.svelte` — composes `ListItem` + inline rename (reuse the consolidated
  `lib/ui/CommitInput` from S1.1 if merged; else the existing text one) + a `lib/ui/ContextMenu` slot for
  per-row verbs (Rename focuses the inline input; Delete = `danger`). Expose `editing` control + `oncommit`.
- Keep everything token-driven; no hardcoded color/px/duration.

## Tests
- Component tests: ListItem renders active/disabled states + fires onclick; EditableRow enters edit mode,
  commits/reverts, and surfaces the actions/context-menu slot.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.

## Acceptance
Two reusable primitives under `lib/ui` matching the current row look pixel-for-pixel; tested; full sweep
green. (No call-sites changed yet — that's S2.1/S2.2.) Closes #14 (extraction half).

## Report back
Report to parent (orchestrator) with commit SHA, the component APIs (props/snippets), gate totals,
deviations. Leave ROUTER to the orchestrator.
