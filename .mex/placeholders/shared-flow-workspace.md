# Placeholder: shared SvelteFlow workspace infrastructure

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`TriggerGraphView.svelte` and `PatchGraphView.svelte` both manage SvelteFlow canvas concerns: node/edge adapters, hover state, fit behavior, reconnect/delete handlers, drop-on-node behavior, backgrounds, controls, and UX decoration.

Extract shared infrastructure such as:

- `FlowWorkspace.svelte`
- shared fit/reconnect helpers
- shared drop-on-node helper
- shared hover/decorated edge utilities
- a small per-view adapter API so trigger and patch graphs keep their own domain validation

## Constraints

- Do not blur trigger-graph and patch-graph domain rules.
- Keep visual and interaction behavior unchanged before adding new graph UX.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live test of both Trigger and Patch graph editing, reconnect, delete, pan/zoom, fit, and drag/drop.
