# Handoff — Deep-Review Implementation Orchestrator

**From:** review orchestrator (Fable), session of 2026-07-29. The review pipeline is
COMPLETE — this handoff is for EXECUTION of the approved initiatives.
**Work here:** `/Users/trent/.twux/worktrees/review` (branch `feat/ota-discord-announce`,
HEAD `c212ab9` pushed). Verify your branch before every commit.

## Your mandate

`10-ranked.md` — **all 12 rows approved by Trent, in ranked order** (all `queued`;
INIT-11 `blocked` on INIT-04). `11-decisions.md` **is the execution authority** — it
resolves every open question and overrides plan text where they disagree. Each row's
plan is `09-synthesis/<initiative>.json`: step-by-step, per-step verification, sequenced
into waves that land as separate green commits.

Execution order = rank order: INIT-03 → INIT-04 → INIT-01 → INIT-02 → INIT-06 → then
the light track (05, 07, 11-after-04, 08, 09, 10-before-02, 13). Two hard sequencing
edges beyond rank: **INIT-10 lands before INIT-02** (shrinks its 37-file test diff) and
**INIT-11 only after INIT-04** (main.ts seam). **INIT-01 and INIT-04 must never run
concurrently** — same file, constitutional seam gate.

## Branch strategy — settle with Trent first

The review branch is based on a pre-#150 main. Since then main merged PRs #150–#152
(including this very branch's OTA feature). The fix batches (1–3, kit-mirror removal)
and all review artifacts live here, not on main. Before executing initiative 1, agree
with Trent: merge/rebase this branch into main first, or execute on a fresh branch off
current main and cherry-pick the fix batches. Do not guess.

## Operational rules (each learned the hard way — see HANDOFF.md for the original list)

- **Concurrency lives in code, never in a prompt.** Machine crashed once already.
  Trent's caps as of 2026-07-29: subagents 2–3 wide; check `twux usage` before every
  launch round; no launches past ~92% of the 5h window; `twux wake --at reset` and keep
  going. Wake takes full ISO times (`--at 2026-07-29T17:50:00+10:00`), not `17:50`.
- **`pnpm gates`, never `pnpm test`** (machine-wide mutex). Run it FOREGROUND and read
  the output — a backgrounded gates run deadlocked an agent tonight.
- **Re-measure the test baseline at your starting HEAD.** Hard-coded counts (2,981 /
  2,968) in plan text are stale by construction.
- **Verify the artifact, never the exit code.** Diffstats against declared file sets,
  counts against expectations, `git ls-remote` after every push.
- **Pushes may 403 as `advatektrenta`** (cross-project gh account flip). Fix without
  touching global state:
  `git -c credential.helper= -c 'credential.helper=!f() { echo username=twadams21; echo "password=$(gh auth token -u twadams21)"; }; f' push origin <branch>`
- **Claude models only.** No Sol/codex.
- **Coverage gates deletion claims:** a green suite proves nothing about 0%-coverage
  regions — evidence there is the import graph and git history.
- **Fix batches are reviewed by a different model than the fixer** (Phase 6 shape, see
  06-fix-reviews/ for the pattern). Keep that gate for every initiative wave.

## Don'ts

- `dead-code-0001` stays HELD (PatchClipboardToolbar/PatchDiffDialog live) — Trent may
  resurrect patch copy/paste.
- Don't re-run the review pipeline or re-baseline; the artifacts are final.
- INIT-03's sACN 1-based fix changes real wire bytes: Trent re-checks the PixLite patch
  once when it lands — coordinate that moment with him, don't ship it silently mid-week.

## Trent's working preferences (observed, current)

- One step at a time when he's watching usage; he'll widen when he says so.
- He checks claims against git; report verified facts with shas.
- Blunt when something breaks: own it, fix it, move on.
- Escalate product/taste calls with a recommendation and honest costs; on rejection,
  drop the approach entirely.
