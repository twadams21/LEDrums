# Placeholder: split Inspector into focused panels

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`apps/web/src/lib/app/docks/Inspector.svelte` currently dispatches across trigger sources, trigger graph nodes, buses, patch graph nodes, sections, and empty states.

Split into focused components such as:

- `Inspector.svelte` as a small dispatcher
- `TriggerSourceInspector.svelte`
- `TriggerNodeInspector.svelte`
- `PlayNodeInspector.svelte`
- `SwitchNodeInspector.svelte`
- `BusInspector.svelte`
- `PatchNodeInspector.svelte`
- `SectionInspector.svelte`
- shared presentational pieces such as `InspectorHeader`, `ReadRow`, and rename/edit controls

## Suggested approach

Extract one branch at a time while keeping all store mutations unchanged. Start with the most self-contained branch.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live inspector sweep for trigger nodes, patch nodes, sections, bus rows, and empty selection.
