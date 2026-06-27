# Component pass S4.3 — WS protocol single-source-of-truth

PRD §S4.3. Overlay PR **#4** (app-shared slice — **NOT core**, per D2). Branch base `feat/unified-shell`
(worktree — read `_worktree-note.md`). **Independent worktree.** Note #1 (voice-stats on WS callbacks) is
already merged — build on it.

## What this delivers
Removes the drift between the web client's protocol types and the server's, so the wire contract has one
authoritative definition (app-shared, not in pure `packages/core`).

## Scope
- Reconcile `apps/web/src/lib/ws/protocol-types.ts` with `apps/server/src/ws-protocol.ts`, fixing the three
  grounded divergences:
  1. `EffectSpec.paramSpec` — web types it as `ParamSpec[]`, server as `ReturnType<typeof listEffects>[…]`.
     Align on one (export/import `ParamSpec`).
  2. `OutputStatus.universeCount` — server required, web optional. Make consistent (server always sets it →
     required).
  3. `ShowLibraryBlob` — server imports from `./show-library`, web re-defines locally. Single definition,
     both import it.
- Prefer a shared app-level types module (e.g. a small `packages/protocol` or a shared file both import) —
  **keep it out of `packages/core`** (core stays pure; this is the app/WS boundary, distinct from S4.4's
  core-canonical graph *model* types).

## Tests
- `ws-protocol.test.ts` + `lib/ws/client.test.ts` green; add a type-level/assertion test pinning the three
  reconciled shapes if practical.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test`. Confirm `packages/core` untouched.

## Acceptance
Web and server agree on `paramSpec`/`universeCount`/`ShowLibraryBlob` from one source; no re-declaration;
full sweep green. Closes #4.

## Report back
Report to parent (orchestrator) with commit SHA, where the shared types now live, the three fixes, gate
totals, deviations. Leave ROUTER to the orchestrator.
