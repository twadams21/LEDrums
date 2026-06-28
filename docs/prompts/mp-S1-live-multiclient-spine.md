# Slice S1 — Live multi-client spine

_PRD: `docs/plans/2026-06-28-multiplayer-tauri-prd.md` · ready-for-agent · Blocked by: none_

Use the `/implement` skill. You are in a git worktree — read `docs/prompts/_worktree-note.md` first. **Do NOT touch `packages/core`** (the engine/render/output hot path is out of scope and must stay untouched).

## What to build
Make the server support **many** simultaneous clients with **one editor**, and have the editor's authored edits propagate live to the other clients. No Takeover UI and no full read-only gating yet (that's S2) — here, the **first** client to connect is the editor; later clients are viewers that **live-follow** the editor's broadcast.

End-to-end: two browser tabs connect to the dev server at once (no eviction); tab A (editor) edits a graph/section; tab B (viewer) updates live without a refresh. Rendered frames already broadcast to every client — verify visual parity holds with 2 clients. Lighting output is unaffected by client count (including zero).

## Scope (current pointers — verify before editing)
- **`packages/protocol/src/index.ts`** — add two `ServerMessage` variants:
  - `{ t: 'presence'; editorId: string | null; youAreEditor: boolean; clientCount: number }`
  - `{ t: 'showLibrary'; library: ShowLibraryBlob }` (the live authored-library push; lighter than a full `state` rebuild).
- **`apps/server/src/client-registry.ts`** (NEW) — replaces `SingleClientLock`. Holds many sockets; tracks one editor; socket-decoupled (reuse the minimal `CloseableSocket`-style interface) and **iterable** (the binary frame + JSON broadcast loops iterate it). API: `admit(socket)` (additive — assigns an opaque id; first client with no editor auto-claims editor), `remove(socket)` (if the editor leaves, slot empties; if exactly one client remains it auto-claims so the standalone case stays editable), `editorId`, `isEditor(socket)`/`canMutate(socket)`, `takeover(socket)` (assign editor, return demoted prior — wired in S2), `presenceFor(socket)` (→ the presence payload), `size`, `[Symbol.iterator]`.
- **`apps/server/src/main.ts`** (+ `boot.ts`) — use `ClientRegistry` instead of `SingleClientLock`. On connection: send `state` (carrying the recipient's initial role) + broadcast `presence` to all. On the **editor's** `setShowLibrary`: persist (as today) AND broadcast `{ t:'showLibrary' }` to **other** clients (never echo to the sender). Frame broadcast iterates all clients. Accept `setShowLibrary`/`setShow` only from the editor for now (broader gating is S2).
- **Web** — `apps/web/src/lib/ws/client.ts` (callbacks for `onPresence`/`onShowLibrary`), `apps/web/src/lib/trigger-lab/store.svelte.ts` (a `role` derived from presence; `wireClient` handles presence + live `showLibrary`), `apps/web/src/lib/trigger-lab/store/show-library-sync.ts` (make role-aware: **viewer always follows** the server — adopt every `showLibrary` broadcast + cold `state`; **editor/standalone keeps the `06cb92e` local-wins** behavior; editor ignores its own echo, signature-guarded).

## Acceptance criteria
- [ ] Two WS clients connect simultaneously — neither is evicted.
- [ ] Server assigns exactly one editor (first client) and broadcasts `presence` (`editorId`, `youAreEditor`, `clientCount`) on join/leave.
- [ ] Editor's `setShowLibrary` is persisted AND broadcast to the *other* clients (not echoed to itself).
- [ ] A viewer adopts the broadcast live — its authored UI state updates with no refresh.
- [ ] Editor/standalone retains local-wins cold-load (06cb92e); a viewer always follows the server.
- [ ] Rendered RGB frames broadcast to all connected clients (parity verified with 2 clients).
- [ ] Lighting output runs regardless of client count, including zero.
- [ ] `SingleClientLock` is fully retired (no remaining references).

## Tests to write
- **`apps/server/src/client-registry.test.ts`** (unit, mirror `client-lock.test.ts`): admit many; first auto-claims editor; `canMutate` reflects role; `remove` of a non-editor doesn't change the editor; `remove` of the editor empties/re-elects per the rule; presence payload updates; iteration covers all sockets.
- **Extend `apps/web/src/lib/trigger-lab/store.server-library.test.ts`** (existing capturing-client harness): a viewer live-follows a `showLibrary` broadcast; the editor ignores its own echo; `role` derives from `presence`; role-aware reconcile (editor local-wins vs viewer follow).

## Verify
`pnpm typecheck` (0) and `pnpm test` (all green; add the new tests). Report commit SHA(s) + files to the orchestrator.
