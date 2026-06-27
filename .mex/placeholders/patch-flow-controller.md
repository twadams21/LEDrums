# Placeholder: extract patch graph flow controller

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Move patch graph orchestration out of `apps/web/src/lib/app/views/PatchGraphView.svelte` into testable controller/helper modules.

Candidate modules:

- `patch-flow-controller.svelte.ts` for Svelte-facing state and effects
- `patch-flow-adopt.ts` for cold-load/live-routing adoption
- `patch-flow-commit.ts` for commit signatures and server project updates

## Constraints

- Keep `patch-routing.ts` pure and reuse it as the model for testable helpers.
- Preserve behavior for output adoption, routing signatures, shell live-routing publication, reconnect, and cleanup.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live Patch graph smoke: add/remove/reconnect outputs, reload, server reconnect, and dense/straddle hardware cases.
