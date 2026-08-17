# F1 — #187 amendment: now-playing = persistent left side bars, drop the dot

**Feedback wave (Trent, 2026-08-17 morning review of stack #194).** Amends PR #187.
Worktree `/Users/trent/.twux/worktrees/nowplay`, branch `feat/graph-now-playing` (synced to
origin @ d71db54). Original brief: `S2-now-playing.md` — read it for context and anchors.

## Trent's verdict (verbatim)

> "now playing" dot on graph cards should use the existing left side bars and just be
> persistent rather than fading out. The dots look too much like the thumbnail nodes.

## What to do

1. **Remove the now-playing dot entirely** — it reads as another thumbnail node.
2. **Reuse the existing left-side bars** on graph cards (the tinted left bars / engine fire
   trace that landed with the graph list, #179) as the now-playing indicator: while a graph is
   now-playing, its left bars are **lit persistently** — no fade-out. When it stops being the
   playing graph, the persistent state releases (a fade-out on release is fine).
3. Verify from the code what the left bars' current fire-trace behaviour is (flash on trigger,
   fade) and layer the persistent state on top without breaking the trigger flash for
   non-playing graphs. Don't invent a new affordance — this is a re-use.

## Scope fence

May touch: the graph rail card component(s) (`TriggerGraphsRail.svelte` and whatever renders
the card/bars), its store wiring for now-playing state (VoiceStat.pad wire from S2 stays as
is), styleguide `SectionGraph.svelte` entry, tests, ui-shot preset for the rail.
Non-goals: thumbnail rendering, the wire protocol, other views.

## Evidence & rules

- `pnpm typecheck` green; targeted `pnpm --filter @ledrums/web exec vitest run <touched test
  files>` only — **NO full `pnpm test` sweep** (orchestrator-only rule).
- UI verify: own dev stack on **LEDRUMS_WEB_PORT=5281 PORT=4381 LEDRUMS_WS_PORT=4381**, ui-shot
  with `UI_SHOT_BASE=http://localhost:5281`. Ports 5173/4321 are OCCUPIED (Trent's live
  preview) — never touch them, never pkill by pattern; kill your own dev server by PID.
- Commit on `feat/graph-now-playing`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/graph-now-playing`.
- Report ≤15 lines: what changed, evidence, pushed SHA.
