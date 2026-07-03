# S41 assignment — Library refs: resolve/detach/guards (Group J, issue #53)

- **Slice:** S41 in `docs/plans/2026-07-02-rock-solid/slices/J-presets-song-library.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/J` (S39+S40 merged) · **Your branch:** `slice/S41`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git switch -c slice/S41 group/J`
- **Predecessor context:** `docs/handoff/rock-solid/S40.md` (committed, in your tree) — its
  context pack defines your foundation: `extractSongClosure` + `songNamespace` in
  `store/song-library.ts` (closures are deep-cloned, alias nothing), `SongLibrary`/`LibrarySong`
  + defensive load in `persistence.ts`, `SongLibrarySync` reconcile plans, server named-blob
  seam already wired. Resolve = the inverse of extract: union namespaced records into the
  runtime view; looks' `busId` keys stay show-level (map to the importing show's buses).
- **Commits:** incremental, one intent per commit, subject `S41: <intent>`
- **Gates:** `pnpm typecheck` (0 errors) + `pnpm test` (no skips) green before the report commit
- **Report:** `docs/handoff/rock-solid/S41.md`, committed on `slice/S41` as your FINAL commit
  (commit this assignment file with it).
  **Slim contract — max 30 lines:** Summary · Acceptance (checkbox → one line of evidence) ·
  Gates · Deviations · Context pack for S42 (UI): store ops signatures
  (export-to-library / import-reference / detach / library CRUD + delete guard), how a
  referenced song appears in the runtime view, used-by lookup for the UI.
- **Scope fence:** pure resolver + store operations + guards + tests ONLY. No UI (S42 owns all
  surfaces). Canonical propagation: editing a referenced song edits the LIBRARY copy — other
  shows' resolved views update. Detach clones the closure into the show under a fresh namespace.
  Delete of an in-use library song is BLOCKED and must report the using shows. Update the
  no-cross-show-bleed test to state the library exception explicitly (slice acceptance).
- **AGENTS.md non-negotiables:** `packages/core` stays pure; no sync IO in the render path.
- **When done:** `twux send-message --session parent --status ready --body "S41 done: slice/S41 @ <sha>, report docs/handoff/rock-solid/S41.md, sweep green"`
