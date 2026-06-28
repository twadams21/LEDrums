# Component pass S3.4 — Server main.ts split

PRD §S3.4. Overlay PR **#5** (split server `main.ts`); **#2** (shared atomic writer) is **already merged**.
Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **Blocked by:** none — independent
worktree (server package boundary). Paired with **S3.5** (core splits) — split out so server and core are
separate, parallel worktrees.

## What this delivers
The server entry god-file split behind its existing tests: `apps/server/src/main.ts` (428) stops conflating
dispatch, IO, and boot.

## Scope
- Extract the `handleClientMessage` switch into `apps/server/src/handlers/projects.ts` (load/save/list
  dispatch) + `apps/server/src/handlers/voice-input.ts` (programChange/cc/setShow/key/recallSection/midi/osc/
  transport recall).
- Extract the listen/lanUrls/shutdown orchestration into `apps/server/src/boot.ts`.
- `main.ts` shrinks to ~250 lines of wiring. Build on the already-merged atomic-writer (#2); do not re-do it.
- API/behaviour unchanged — structure only.

## Tests
- `voice-engine-host.test.ts`, `input-router.test.ts`, `projects.test.ts`, `show-library.test.ts`,
  `client-lock.test.ts`, etc. stay green untouched (the contract).

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test`. Server counts must not drop.

## Acceptance
Server `main.ts` ≤ ~250 lines via `handlers/*` + `boot.ts`; all server tests green; full sweep green.
Closes #5.

## Report back
Report to parent (orchestrator) with commit SHA, the module split + sizes, gate totals, deviations. Leave
ROUTER to the orchestrator.
