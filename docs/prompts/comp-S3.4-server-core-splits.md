# Component pass S3.4 — Server main + core engine/compositor splits

PRD §S3.4. Overlay PR **#5** (split server `main.ts`); **#2** (shared atomic writer) is **already merged**.
Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **Independent worktree (separate
package boundary).** Lower priority than the web slices. **Keep `packages/core` PURE** (no Node/DOM/IO).

## What this delivers
The non-web god-files split behind their existing tests: the server entry and the two largest core voice
modules.

## Scope
- **Server `apps/server/src/main.ts` (428) — #5:** extract the `handleClientMessage` switch into
  `handlers/projects.ts` (load/save/list dispatch) + `handlers/voice-input.ts` (programChange/cc/setShow/
  key/recallSection/midi/osc/transport recall), and the listen/lanUrls/shutdown orchestration into `boot.ts`.
  `main.ts` shrinks to ~250 lines of wiring. (The atomic-writer extraction #2 is done — build on it.)
- **Core `packages/core/src/voice/engine.ts` (760):** extract `eval-graph.ts` (evalNode/childrenOf/
  evalValueSwitch), `voice-pool.ts` (spawn/acquireSlot/release/findActiveVoice), `envelope-tick.ts`. The
  `VoiceBusEngine` stays the public class (~420). PURE — no IO.
- **Core `packages/core/src/voice/compositor.ts` (388):** extract `pattern-renderer.ts` (sample loop + pixel
  masking) + `generator-bridge.ts` (hosted-generator setup). PURE.
- Determinism non-negotiable: no new global state; eval stays a pure function of `RenderContext`.

## Tests
- Server: `voice-engine-host.test.ts`, `input-router.test.ts`, etc. green untouched. Core:
  `voice/engine.test.ts` (999) + `voice/compositor.test.ts` green untouched — they are the contract.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test`. Verify `packages/core` imports nothing from
Node/DOM/IO (the non-negotiable). Counts must not drop.

## Acceptance
Server `main.ts` ≤ ~250 lines via handlers/boot; core engine/compositor split into pure submodules; all
server + core tests green; core stays pure; full sweep green. Closes #5.

## Report back
Report to parent (orchestrator) with commit SHA, the module splits + sizes, confirmation core stayed pure,
gate totals, deviations. Leave ROUTER to the orchestrator.
