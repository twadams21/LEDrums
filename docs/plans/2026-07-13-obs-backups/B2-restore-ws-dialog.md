# B2 — Restore: WS messages + Backups dialog

Spec: #123. Effort: **high** (UI-significant). Wave 4 (parallel with B3; **merges first**).

## Mission

A panicking drummer at a gig can recover on his own: a Backups dialog lists local snapshots and restores one in two clicks (restore + confirm), and the restore lands atomically with a safety snapshot taken first. Server work is thin orchestration over B1's SnapshotStore; most of this slice's judgment is in the UI.

## What to build

1. **Protocol**: client messages `{t:'listBackups'}` and `{t:'restoreBackup', id}`; server reply `{t:'backupsList', backups: [{id, createdAt, reason, size}]}` — with zod schemas per the package's lock pattern. Restore success needs no dedicated reply: the state broadcast IS the confirmation; a failure returns the handler's existing error shape.
2. **Server orchestration** (client-message handlers): `listBackups` → store.list(). `restoreBackup` → `snapshotPreRisk('pre-restore')` → `restoreFiles(id)` → reload project/show/song state through the same path a cold boot uses → broadcast so every client adopts it like a cold load. Unknown id → rejected without crashing. Engine must keep transmitting through the swap (same expectation as the single-client eviction path).
3. **Backups dialog** (web): follows the ShowBrowser dialog pattern — list rows (relative time + reason chip, e.g. "2 hours ago · before restore"), a Restore action per row, and a confirm step whose copy is part of the spec:
   > Replace the current project, shows, and songs with the backup from **{relative time}**? A backup of the current state will be taken first.
   - Entry point: alongside the existing Show browser affordance in the chrome (verify where ShowBrowser opens from and match it).
   - **UI non-negotiables apply**: compose from the design system; anything new-and-reusable goes into the styleguide and `pnpm design-system` regenerates in this same change; apply `/make-interfaces-feel-better`; verify with `pnpm ui-shot` captures of the dialog (list + confirm states).

## Anchors to verify

- B1's landed `snapshot-store.ts` API — build against what merged, not this brief's paraphrase.
- `packages/protocol/src/index.ts` + schemas — message conventions.
- `apps/server/src/handlers/client-message.ts` — handler + rejection conventions; how `setShowLibrary`/`setProject` broadcast today (the restore broadcast should reuse, not reinvent).
- `apps/server/src/boot.ts` — the cold-load path restore must re-enter.
- `ShowBrowser.svelte` (find it under `apps/web/src/lib/app/`) — the dialog pattern, and the chrome location it opens from.
- `apps/web/src/lib/styleguide/README.md` — the use-or-extend process rule.

## Scope fence

May touch: `packages/protocol/src/**`, `apps/server/src/handlers/client-message.ts`(+test), minimal `boot.ts`/`main.ts` glue for reload-into-running-state, new dialog + chrome entry point under `apps/web/src/lib/app/**`, styleguide + regenerated `docs/design-system.html`, tests, ui-shot captures.
Non-goals: **no reporter/queue/worker files (B3's fence)**, no off-site anything, no cloud restore, no snapshot-store internals changes (consume B1's API; if it's insufficient, escalate).

## Tests

Handler tests: list returns store listing; restore takes pre-risk snapshot then applies then broadcasts (order asserted); unknown id rejected. Store-level restore mechanics are B1's tests — don't re-test them, test the orchestration. Web: dialog logic via the pure-helper + component-test patterns already in the repo; visual via ui-shot.

## Escalation triggers

- The cold-load path can't be re-entered on a live server without restructuring boot — that's an architecture call.
- Restore-while-engine-transmitting shows any frame-loop stall — stop, that's a non-negotiable.
- Any taste question beyond the ShowBrowser pattern + specified confirm copy (placement, naming, extra affordances) — ask, don't invent.
