# S45 assignment — Patch copy/paste: setProject + diff dialog (Group K, issue #55)

- **Slice:** S45 in `docs/plans/2026-07-02-rock-solid/slices/K-clipboard.md` (your `--read`)
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-3`
- **Base branch:** `group/K` (S43 merged) · **Your branch:** `slice/S45`
- **START STEP — do this FIRST, verify with `git branch --show-current`:**
  `git fetch --all && git switch -c slice/S45 group/K`
- **Foundation:** `docs/handoff/rock-solid/S43.md` (committed, in your tree) — clipdoc module is
  DONE: `buildPatchClipDoc(patch)` + `serialize`/`parse` handle the envelope; `remapClipDoc`
  REJECTS 'patch' by design — patches are validated server-side (zod, projectSchema) and applied
  WHOLESALE, never remapped.
- **PARALLEL SLICE:** S44 (authored-kinds clipboard UI) runs concurrently in wt-1. It owns
  graph/section/song copy/paste + any GENERIC UI primitives (toast, confirm dialog). You own
  everything patch: protocol `setProject` message, server handler (validate → apply-once →
  persist → broadcast, single kit reload, NO granular-message replay), voice-host bulk adopt,
  the patch diff confirm dialog (drum count, pixel totals, output hosts, protocol — explicit
  confirm required), Patch view copy/paste toolbar, monitor event on apply. If you need a
  generic primitive S44 is building, build your dialog on your own patch-specific component
  rather than colliding in shared generic files.
- **AGENTS.md non-negotiables:** `packages/core` stays pure; server apply must never block the
  render loop (async persist, fire-and-forget outputs); schema-validate BEFORE any state touch —
  invalid payload = user-visible error, ZERO partial apply. UI bits apply
  `/make-interfaces-feel-better` + compose from the design system.
- **Commits:** incremental, `S45: <intent>` · **Gates:** `pnpm typecheck` + `pnpm test` green
  (server tests with fakes: validate → apply-once → persist → broadcast, per the slice).
- **Report:** `docs/handoff/rock-solid/S45.md` committed on `slice/S45` as final commit (include
  this assignment file). Slim contract — max 30 lines. No context pack needed.
- **When done:** `twux send-message --session parent --status ready --body "S45 done: slice/S45 @ <sha>, report docs/handoff/rock-solid/S45.md, sweep green"`
