# S43 assignment — clipdoc module (Group K, issue #55)

- **Slice:** S43 in `docs/plans/2026-07-02-rock-solid/slices/K-clipboard.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/K` (branched off rock-solid WITH group J merged) · **Your branch:** `slice/S43`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git switch -c slice/S43 group/K`
- **Foundation (group J, in your tree):** `docs/handoff/rock-solid/S40.md` context pack +
  `docs/handoff/rock-solid/group-J.md`. Closure extraction is BUILT and shared:
  `store/song-library.ts:extractSongClosure` + `songNamespace` (deep-cloned, re-key-by-default).
  Your acceptance includes closure equivalence with it via SHARED CODE, verified by test.
  Id discipline: `store/ids.ts` (`nid`/`freshId`/`reserveIds`) — pasted content re-keys through it.
- **Commits:** incremental, one intent per commit, subject `S43: <intent>`
- **Gates:** `pnpm typecheck` (0 errors) + `pnpm test` (no skips) green before the report commit
- **Report:** `docs/handoff/rock-solid/S43.md`, committed on `slice/S43` as your FINAL commit
  (commit this assignment file with it). **Slim contract — max 30 lines:** Summary · Acceptance
  (checkbox → one line of evidence) · Gates · Deviations · Context pack for S44 AND S45 (both
  depend on you): serialize/parse/remap entry points (file:symbol), the ParseError contract,
  what each kind's payload/deps carry, what the UI slices must NOT re-implement.
- **Scope fence:** the pure ClipDoc module + tests ONLY (doc 11: versioned envelope, kinds
  graph/section/song/patch, defensive parse never-throws, remap-on-materialize with
  identical-content reuse + built-in-effect-id exemption, all internal refs through the remap
  table — section graph lists, effect/preset ids, modifier wiring, modulation param-ports).
  NO UI (S44), NO setProject/server work (S45). `packages/core` untouched.
- **When done:** `twux send-message --session parent --status ready --body "S43 done: slice/S43 @ <sha>, report docs/handoff/rock-solid/S43.md, sweep green"`
