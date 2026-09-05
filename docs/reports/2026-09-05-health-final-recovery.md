# Health final recovery — server blockers A/B/C

**Status:** DONE, scoped. Three merge blockers fixed in owned server files with exact-counterexample regressions. No push, no UI/core/shared edits, no dependency changes. Machine: Trent's MacBook Pro. Source: `/tmp/ledrums-health-twux/server.md` (parent brief), baseline `ac82a53b`.

## A (P1) — import boot no longer supersedes an unversioned library file with null

`apps/server/src/main.ts`: import-only guard (no atomic authority yet) runs on the existing `inspect*File()` results BEFORE either library is loaded and before any boot snapshot or autosave can create the authority envelope. A present show/song file whose `version` is missing, a string, or otherwise non-numeric is `source: 'invalid'` and boot throws `Unsupported <kind> library file <path>: not a versioned library envelope…`. Absent files still boot as null slots. When `default.state.local.json` exists, the guard is skipped and the authority wins over stale import files, as before. Numeric old/future versions are still rejected by `validateLibraryVersions`. Fail closed on unsupported formats; no migration UI.

Regressions in `main.integration.test.ts`, actual `src/main.ts` process, both engine modes: show `version:"2"` and song missing `version` → boot rejected, original file byte-identical, no authority file written; authority + stale invalid legacy files → boots with authority libraries and no error. Red proof: with HEAD's `main.ts` swapped in, the four import-guard cases fail (2 modes × 2 kinds) and the precedence cases pass; restored file re-passes all 16.

## B (P1) — a successful snapshot is always readable (depth-safe transport)

`serializer-worker.ts`: `read` now returns the validated envelope JSON **text**; the worker still enforces file size, bounded read, decompression cap, envelope/id checks and the post-parse byte budget. `digest` is unchanged (hash of the worker-parsed files). Main parses the text once with iterative `JSON.parse`. Structured clone of a decoded object recurses per nesting level and threw "Maximum call stack size exceeded" for a 22,142-byte, 3,000-level valid bundle. A string clone is a flat copy.

Sync boundary, honestly: the main thread now spends one `JSON.parse` per read instead of one structured-clone deserialisation. `snapshot-store.worker.test.ts` asserts stringify never runs on main and the read parse runs exactly once on main (replacing the old "never parses" assertion, which encoded the broken transport).

## C (P2) — optional offsite preparation cannot fail the local write

`pack` returns `{ compressed, text? }`; the bundle is no longer decoded in the worker. `snapshot-store.ts` writes the compressed bytes first, rotates, then inside its own try/catch parses the text and calls `onSnapshot`. The text is the worker-retained call-time capture, so a live source that mutates after the call still hands off the call-time revision. A parse or callback throw is logged; the snapshot still returns its meta.

## Evidence

- `/tmp/eval/p11-depth-regression.mts` (parent's repro): local and offsite snapshots succeed with 1 file each, old reader and new reader both accept, coordinator commits and its safety is restorable. Before the fix: new read returned null, offsite variant rejected with zero files.
- `pnpm --filter @ledrums/server exec vitest run src/backups` → 5 files, 44 tests passed (2 new: deep fixture read/restore with and without onSnapshot; call-time revision + isolated handoff failure).
- `pnpm --filter @ledrums/server exec vitest run src/main.integration.test.ts` → 16 passed (6 new) on `process.execPath`; SEA binary run not repeated here (parent-owned final checks; `apps/desktop/scripts/snapshot-worker-sea.probe.mjs`).
- `pnpm --filter @ledrums/server typecheck` → clean.
- Not run: full sweep, web typecheck, SEA rebuild (per brief).

## Matched read timing (single run, pinned Node v22.23.1, source not SEA, 6.4 MB fixture, `snapshot-worker.probe.ts` with `P11_BASELINE_MODULE=/tmp/ledrums-p11-sea-20260905-c/baseline.cjs`)

| Operation | Elapsed | Max main-thread timer gap |
|---|---:|---:|
| Old store read (same run) | 126.50 ms | 87.13 ms |
| Worker read, text transport (this change) | 236.08 ms | 75.16 ms |
| Worker read, object clone (prior report, source) | 381.05 ms | 145.37 ms |

Main-thread stall on read is now comparable to the old parser in this run; total elapsed is still longer than the old store (worker gunzip + parse + validation stringify, then main parse). One run, not an SLA. Capture-side numbers are unchanged in kind: warm burst 2 accepted / 6 refused (74.21 ms submission, 148.94 ms max gap) vs old 8/0 (45.67 ms, 366.34 ms); the reliability/bounded-admission justification from `2026-09-05-health-backup-worker.md` stands and no frame-budget, RSS or FPS claim is made. Off-thread JSON remains PARTIAL for multi-MB non-blocking acceptance (clone-in and parse-out stay synchronous on main).

## Limitations

- The guard treats an unparseable (corrupt JSON) legacy library file the same as an unversioned one: boot refuses until the file is fixed or moved. Previously it booted as "no library". This is the fail-closed policy; the message names the path.
- Off-site handoff now parses on main after the write (previously the worker parsed); same sync class as read.
