# Placeholder: extract reusable editable row components

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Reduce duplicated row/edit/context-menu patterns in `ObjectsView.svelte` and `SectionsView.svelte`.

Candidate shared pieces:

- `EditableRow.svelte`
- `InlineRename.svelte`
- `RowActions.svelte`
- `ObjectTypeRail.svelte`
- pure action builders for menus and duplicated row commands

## Constraints

- Keep keyboard, focus, context-menu, and commit/cancel behavior intact.
- Do not combine unrelated domain actions; share presentation and interaction shell only.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live Objects and Sections CRUD sweep: rename, duplicate, delete, context menu, keyboard cancel/commit, active selection.
