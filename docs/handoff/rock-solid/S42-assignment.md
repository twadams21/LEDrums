# S42 assignment — Library UI + naming pass (Group J, issue #53)

- **Slice:** S42 in `docs/plans/2026-07-02-rock-solid/slices/J-presets-song-library.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/J` (S39–S41 merged) · **Your branch:** `slice/S42`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git switch -c slice/S42 group/J`
- **Predecessor context:** `docs/handoff/rock-solid/S41.md` (committed, in your tree) — its
  context pack lists every store op you need (exportSongToLibrary / importSongReference /
  detachSongReference / renameLibrarySong / deleteLibrarySong→usedBy[] / songLibraryList /
  resolvedSongs / resolvedView). The store layer is DONE — S42 is surfaces + naming only.
- **UI NON-NEGOTIABLES (AGENTS.md):** compose from the design system
  (`docs/design-system.html` — tokens, primitives, composites); anything NEW and reusable gets
  added to the styleguide entry (`apps/web/src/lib/styleguide/` — see its README) AND
  `pnpm design-system` regenerated IN THE SAME CHANGE. Apply `/make-interfaces-feel-better`
  (design-engineering polish pass) — the acceptance criteria require it.
- **Commits:** incremental, one intent per commit, subject `S42: <intent>`
- **Gates:** `pnpm typecheck` (0 errors) + `pnpm test` (no skips) green before the report commit
- **Report:** `docs/handoff/rock-solid/S42.md`, committed on `slice/S42` as your FINAL commit
  (commit this assignment file with it). **Slim contract — max 30 lines:** Summary · Acceptance
  (checkbox → one line of evidence) · Gates · Deviations. No context pack needed (S42 closes
  group J; K's S43 builds on S40's module, not your UI).
- **Scope fence:** Songs master-detail source split ("This show" vs "Library"), song row actions
  (Add to library / Import from library / Detach copy), used-by counts on library rows, delete
  disabled with "Used by N shows" reason, and the naming pass ("Song Library" / "Setlist" across
  rail labels, UI copy, and identifiers this initiative touched). NO new store semantics — if a
  store op is missing something, note it under Deviations rather than reworking S41's layer.
- **When done:** `twux send-message --session parent --status ready --body "S42 done: slice/S42 @ <sha>, report docs/handoff/rock-solid/S42.md, sweep green"`
