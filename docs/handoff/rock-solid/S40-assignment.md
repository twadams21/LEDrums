# S40 assignment — Library persistence + closure extraction (Group J, issue #53)

- **Slice:** S40 in `docs/plans/2026-07-02-rock-solid/slices/J-presets-song-library.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/J` (S39 is merged — presets are snapshots, params node-local) · **Your branch:** `slice/S40`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git switch -c slice/S40 group/J`
- **Predecessor context:** `docs/handoff/rock-solid/S39.md` (committed, in your tree) — read its
  "Context pack (S40)" section: closure = sections → graph keys → play nodes' effectId + presetId
  (provenance label, NOT a runtime dep) + params; `presetUsageCount` is reusable.
- **Commits:** incremental, one intent per commit, subject `S40: <intent>`
- **Gates:** `pnpm typecheck` (0 errors) + `pnpm test` (no skips) green before the report commit
- **Report:** `docs/handoff/rock-solid/S40.md`, committed on `slice/S40` as your FINAL commit
  (commit this assignment file with it so the tree ends clean).
  **Slim contract — max 30 lines:** Summary · Acceptance (checkbox → one line of evidence) ·
  Gates (typecheck 0; test counts) · Deviations (if any) · Context pack for S41 AND S43
  (both depend on you): closure-extraction entry points (file:symbol), library blob
  shape/versioning, server named-blob store seam, re-keying discipline — pointers, not prose.
- **Scope fence:** persistence document + server named-blob generalization + pure closure
  extraction + tests ONLY. No UI (S42), no refs/resolve/detach (S41), no clipboard (S43).
  Existing show persistence must remain untouched (regression-proof it).
- **AGENTS.md non-negotiables:** `packages/core` stays pure (no IO); defensive versioned load
  (never throws).
- **When done:** `twux send-message --session parent --status ready --body "S40 done: slice/S40 @ <sha>, report docs/handoff/rock-solid/S40.md, sweep green"`
