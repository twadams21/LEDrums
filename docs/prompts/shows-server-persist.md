# Server-authoritative show persistence (shows survive a localStorage clear)

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER
`graphs-generic` + `objects-crud` are merged** (it restructures store hydration +
persistence — highest blast radius; build it on a settled store). Highest-risk slice — keep
web+server green continuously.

## Problem
Shows live only in localStorage (`ledrums:shows:v1`) — clearing browser storage wipes them.
Fix: make the **server** the source of truth for the authored show library (like the S7
routing `Project`), hydrated on cold load; localStorage demoted to a cache.

## Locked decision
**Server-authoritative.** The server owns + autosaves the show library file, broadcasts it
on cold load (the `state` adopt path), and the **single-client lock** (S7) applies.
localStorage stays as a fast local cache (offline / first paint) but the server wins.

## The seam (reuse S7)
S7 already does this for the routing `Project`: debounced, async/off-render-loop, atomic
temp+rename to a machine-local file, boot-recovery, shutdown-flush, single-client lock, and
the web adopts the server `Project` from the WS `state` message. **Mirror that exactly** for
the authored show library — do NOT invent a new persistence mechanism.

## Scope
- **Server** (`apps/server/src/`): persist the **show library** (the authored
  `ShowLibrary`: shows + activeShowId) to a machine-local file alongside the project
  autosave (e.g. `projects/default.shows.local.json`). Autosave on change (debounced,
  atomic, off-loop), boot-recover, shutdown-flush. Carry it in the WS `state` message (or a
  parallel message) on connect/cold-load. Apply the existing single-client lock.
- **WS protocol** (`ws-protocol.ts`): a message to push the authored show library
  server→client on `state`, and client→server on authored change (mirror how the project /
  `setShow` flows today — reuse the existing authored-sync path if one exists, else add a
  `setShowLibrary`-style message). Keep it consistent with the existing autosave signature
  guards.
- **Web** (`apps/web/src/lib/trigger-lab/persistence.ts` + `store.svelte.ts`): on connect,
  **adopt the server's show library** if present (signature-guarded like the S7 cold-load
  `Project` adopt — don't clobber the user's in-flight edits / own echo). localStorage
  becomes a cache: write-through for offline, but the server library wins on cold load. The
  store's existing show API (`newShow`/`openShow`/…) now drives the server library too
  (autosave already debounced — route it to the server send + localStorage cache).
- Preserve the existing legacy migration (`ledrums:authored:v1` → one Default Show) for the
  pure-offline first run before any server library exists.

## Tests
- Server: show-library autosave + boot-recover + shutdown-flush (mirror the S7 project
  tests); single-client behavior unchanged.
- Web: cold-load adopts the server library (signature-guarded, no clobber of in-flight
  edits); localStorage-cache fallback when server has none; no cross-show bleed preserved;
  legacy single-blob migration still works on a fresh offline boot.

## Gate discipline
Per-package typecheck/test continuously; full `pnpm typecheck && pnpm test` on the committed
tree. Do NOT regress the existing single-client + project autosave. `packages/core` stays
pure; autosave stays off the render loop, fire-and-forget.

## Acceptance
Clearing browser localStorage no longer loses shows (they reload from the server); cold load
on a fresh browser shows the server library; localStorage works as a cache; single-client +
no-bleed preserved; full sweep green. (Live `:5173` cold-load + storage-clear spot-check
owed — flag it prominently.)

## Report back
Parent with commit SHA(s), the server file + WS message(s) added, the cold-load adopt +
signature-guard approach, gate totals, deviations. Commit before reporting; ROUTER to orchestrator.
