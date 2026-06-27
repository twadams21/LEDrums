# Placeholder: shared WebSocket protocol

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

- Extract the duplicated WebSocket message types currently mirrored between `apps/server/src/ws-protocol.ts` and `apps/web/src/lib/ws/protocol-types.ts`.
- Add real runtime payload validation instead of only checking the `t` discriminator and casting.
- Preserve package boundaries: shared protocol code must stay free of Node, DOM, and browser-only imports.
- Keep server and web imports simple enough that future protocol changes happen in one place.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live `:5173` smoke test for connect, state, stats, frame, project, and show-library messages.
