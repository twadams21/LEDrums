# Placeholder: split server main

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`apps/server/src/main.ts` currently owns boot, engine host construction, HTTP, WebSocket routing, project IO, show-library IO, stats broadcasting, OSC input, transport recall, and shutdown flushing.

Split this into small, named modules without changing behavior:

- server boot/state composition
- HTTP/static server setup
- WebSocket gateway and single-client lock
- client message routing
- voice-mode message handling
- legacy-mode message handling
- stats broadcasting
- transport/project recall
- shutdown flush handling

## Suggested approach

Move one seam at a time and keep `main.ts` as an orchestrator until the end. Avoid semantic changes in the same PR.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Start server and connect the web app to verify state, frame, stats, project save/load, and show-library save/load.
