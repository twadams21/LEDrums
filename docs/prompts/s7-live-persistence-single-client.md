# S7 — Live project persistence + single-client lock (server)

New work on the LEDrums server (`docs/prompts/patch-graph-authoritative.md` for context). Branch `feat/unified-shell`. **Server-side only — do NOT touch `packages/core`, `packages/io`, or `apps/web`.** This must stay disjoint from a parallel routing slice (S6) that edits core/io/web.

## Goal
1. **Live persistence (no save button).** The server's authoritative `Project` is written to disk automatically on every authoritative change, so a crash mid-flight recovers cleanly on the next boot.
2. **Single client.** Only ONE client may be connected to the server at a time.

## (1) Live persistence
- The server already has `saveProject`/`loadProject` infra (`apps/server/src/main.ts`, project loading + `assertProjectIntegrity`). Reuse it — don't reinvent the serializer.
- Make the save **automatic**: whenever an authoritative mutation is applied (`setKitOutputs`, `setKitTransform`, `setInputMap`, `setOutput`, `setShow`, song/section edits — every reducer that changes the persisted `Project`/`Show`), mark the project dirty and **debounced-autosave** (~300–500ms) to its project file.
- **Atomic write**: write to a temp file + `rename` so a crash never leaves a half-written project.
- **Boot recovery**: on startup, load the persisted project if present (+ `assertProjectIntegrity`); only fall back to `defaultProject()` seed when no saved file exists. The persisted file is the source of truth across restarts.
- Keep it off the render/transmit hot path (fire-and-forget; never block the engine loop — see CLAUDE.md non-negotiables).

## (2) Single-client lock
- Enforce exactly one live client websocket. **Policy: newest wins** — on a new connection, cleanly close any existing client first (a clear close code/reason, e.g. "superseded by a new connection"). This makes reconnect-after-crash work (the dead socket is replaced) without wedging on a stale connection.
- Make sure engine/output keeps running regardless of client count (a disconnected client must not stop transmission).

## Gate discipline
- During work: `pnpm --filter @ledrums/server typecheck` + `pnpm --filter @ledrums/server test`. Run the full `pnpm typecheck && pnpm test` only on your committed clean tree.
- Add tests: a persistence test (mutation → debounced write → reload restores it; atomic temp+rename) and a single-client test (second connection evicts the first; engine keeps running).

## Acceptance
- Mutating routing/geometry/output then killing + restarting the server recovers the change (no save button pressed).
- A second client connection supersedes the first; only one is ever live.
- Server typecheck/tests green; no `apps/web`/`packages/*` files touched.

## Report back
Report to parent (`twux send-message --session parent`) with commit SHAs, files, the eviction policy as implemented, gate output, deviations. **Commit on `feat/unified-shell` before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.
