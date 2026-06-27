# Component pass S1.5 — MasterDetail layout primitive

PRD §S1.5 / §A2. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **PR mapping:**
PRD finding. **Foundation slice; S2.2 (views adoption) depends on it.**

## What this delivers
The shared master-detail scaffold that `SectionsView` and `ObjectsView` both hand-roll: a left selector
rail (type/section list) + a scrollable detail pane of rows, with row rendering delegated to a slot. Extract
it so both views collapse onto one layout and the chrome is editable in one place.

## Scope (new file)
- `apps/web/src/lib/ui/MasterDetail.svelte` — props/snippets: a `master` snippet (left rail items), a
  `detail` snippet (right pane), selection state in/out, and consistent token spacing/borders matching the
  current Sections/Objects layout. Keep it layout-only (no domain knowledge) so both views reuse it.
- Pair it with `EditableRow` (S1.2) for rows — but this slice ships ONLY the layout primitive + a demo/test;
  the two views adopt it in S2.2.

## Tests
- Component test: renders master + detail slots, selection drives which detail shows.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.

## Acceptance
A layout-only `MasterDetail` under `lib/ui`; tested; full sweep green. (Adoption in S2.2.)

## Report back
Report to parent (orchestrator) with commit SHA, the API, gate totals, deviations. Leave ROUTER to the
orchestrator.
