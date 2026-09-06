---
name: authoritative-recall-sync
description: Preserve server-owned setlist recall ordering across reconnects, restarts, and delayed canonical references.
triggers:
  - "recall synchronization"
  - "authoritative recall"
  - "reconnect ordering"
edges:
  - target: context/architecture.md
    condition: when changing ownership between core, server, protocol, and web recall state
last_updated: 2026-09-06
---

# Authoritative Recall Synchronization

## Context

The voice engine owns the active song and section. The server owns the clock, accepted-recall
sequence, and boot session identity. The browser may send a recall only for explicit user input;
server state and `recalled` messages are observations, not commands.

## Steps

1. Keep active song and section in the engine, and expose them through a typed host boundary.
2. Put `activeSongId`, `activeSectionId`, `showRevision`, `recallSequence`, and `sessionId` in the
   state handshake. Put `sessionId` on every accepted `recalled` message.
3. Generate `sessionId` at the server boot/host boundary. Never put ordering state in deterministic
   core render context.
4. On the client, reset recall ordering whenever `sessionId` changes. Hold the newest authoritative
   recall pending until its canonical song and section resolve; retry after both library updates.
5. Treat a valid zero-section song as `(songId, null)`. A legacy top-level section must use
   `songId: null`; arbitrary song ids must fail closed.
6. Keep accepted diagnostics and queue order at the engine-processing boundary. Do not broadcast
   rejected inputs or echo adopted state back to the server.

## Gotchas

- Numeric revisions and sequences are not comparable across server sessions.
- Do not advance the client ordering gate before canonical reference resolution.
- A missing section must not be allowed to replace a valid current selection.
- Reconnect and autosave `setShow` must not be followed by a cached `recallSection`.
- Null section is a state value, not an instruction to retain the previous section look.

## Verify

- Protocol zod tests cover session identity and explicit null recall fields.
- Core/server tests cover accepted-only diagnostics, legacy identity validation, and zero sections.
- Web tests cover viewer reconnects, lower revisions after restart, pending canonical replay, and no
  ping-pong.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm design-system`, and strict bar shots.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` and `context/architecture.md` when ownership or wire fields change.
- [ ] Add a regression test before changing the pending/ordering contract.
