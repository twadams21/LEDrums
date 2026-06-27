# Component pass S4.5 — Comment hygiene + misc consistency

PRD §S4.4. Overlay PR **#20** (stale source comments). Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **Independent worktree.** Small, low-risk cleanups — comments + two tiny code fixes.

## What this delivers
Refreshes stale initiative-name comments in live source and fixes two minor consistency nits the explorers
flagged.

## Scope
- **#20 comments:** sweep live source for stale slice/initiative references (`U4`, `S7`, `velocity`-fold,
  and other internal codenames) that no longer match the shipped model, and update/remove them. Comments
  only — no behaviour change. (`git grep -n "U4\|S7\|velocity"` in `apps/web/src` + `packages/core/src` as a
  starting net; use judgment — keep accurate references.)
- **Dark-pixel RGB:** `Pixels.svelte` uses normalized `DARK_R/G/B` (0.05,0.05,0.07) while `Pixels2D.svelte`
  uses `[18,22,30]` (8-bit) — extract one shared constant (one unit) used by both.
- **`--radius-card` anomaly:** the token is `0px` with a "cards are square" comment yet has ~24 uses.
  Investigate: confirm it's intentionally `0` (square) and either keep + document clearly, or, if it's meant
  to be a real radius, flag to Trent rather than guessing. Note your finding; don't change the value without
  a decision.

## Tests
- No behaviour change; typecheck + existing tests stay green. The shared dark-RGB const should keep
  visualizer rendering identical.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP** for any `.svelte` touched.

## Acceptance
Stale comments corrected; one shared dark-pixel RGB constant; `--radius-card` investigated + documented (or
escalated); full sweep green; no behaviour change.

## Report back
Report to parent (orchestrator) with commit SHA, comments updated, the dark-RGB consolidation, the
`--radius-card` finding, gate totals, deviations. Leave ROUTER to the orchestrator.
