# S44 assignment — Clipboard copy/paste UI (Group K, issue #55)

- **Slice:** S44 in `docs/plans/2026-07-02-rock-solid/slices/K-clipboard.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/K` (S43 merged) · **Your branch:** `slice/S44`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git switch -c slice/S44 group/K`
- **Foundation:** `docs/handoff/rock-solid/S43.md` (committed, in your tree) — the clipdoc
  module is DONE. You call `buildGraphClipDoc`/`buildSectionClipDoc`/`buildSongClipDoc` +
  `serialize` on copy, `parse` → `isClipParseError` → toast on paste, `remapClipDoc` + union
  the RemapResult on materialize. Do NOT re-implement closure/re-key/ref-rewrite.
  NOTE: copy sources = the RESOLVED view (`store.resolvedView` — S42) so referenced library
  content copies correctly.
- **PARALLEL SLICE:** S45 (patch copy/paste) runs concurrently in wt-3. It owns
  `kind:'patch'` end-to-end (protocol setProject, server handler, patch diff dialog, Patch
  view toolbar). You own the AUTHORED kinds (graph/section/song). Shared file risk: if you
  both need a generic confirm-dialog or toast primitive, YOU own generic UI additions; S45
  builds its patch-specific dialog on top. Keep store methods in separate regions.
- **UI NON-NEGOTIABLES (AGENTS.md):** compose from the design system (`docs/design-system.html`);
  anything new+reusable → styleguide entry + `pnpm design-system` regenerated in the same
  change; apply `/make-interfaces-feel-better`.
- **Commits:** incremental, `S44: <intent>` · **Gates:** `pnpm typecheck` + `pnpm test` green
- **Report:** `docs/handoff/rock-solid/S44.md` committed on `slice/S44` as final commit (include
  this assignment file). Slim contract — max 30 lines. No context pack needed (K closes after
  S44+S45).
- **Scope fence:** copy on graph rows / section headers / song rows (system clipboard via
  navigator.clipboard, in-app section clipboard kept as parallel fast path); paste entries in
  matching contexts; paste-song destination dialog (Library vs this-show — slice locks BOTH);
  friendly toast on non-ClipDoc content; paste-text-field fallback where clipboard read is
  unavailable. NO patch kind (S45's).
- **When done:** `twux send-message --session parent --status ready --body "S44 done: slice/S44 @ <sha>, report docs/handoff/rock-solid/S44.md, sweep green"`
