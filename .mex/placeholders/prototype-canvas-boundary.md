# Placeholder: clarify prototype canvas boundary

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`NodeCanvas.svelte` is retained for the old trigger prototype route while production Trigger graph UX has moved to SvelteFlow.

Make that boundary explicit:

- Move prototype-only canvas files under a clearly named prototype path, or add a local README documenting why they remain.
- Remove imports from production paths if they are accidental.
- Prefer deleting stale prototype code only after the prototype route is confirmed unnecessary.
- Keep production graph metadata and helpers out of the prototype-only module.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Confirm production Trigger graph still renders.
- If `/?proto=trigger` is intentionally supported, confirm it still opens.
