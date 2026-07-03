# Wave 1 assignment — UI-shot tooling + live smoke pass

**Agent:** one fable session (own window). **Worktree:** `../ledrums-wt/wt-1` (verify `git status --porcelain` is EMPTY first). **Branch:** `wave-1/ui-shot-smoke` off local `rock-solid` (must include commit 45b5fff+). **Parent:** report via `twux send-message --session parent` (≤30 lines; the committed report doc carries the detail).

**Read first:** `docs/plans/2026-07-03-phase2-review/PHASE0-RECONCILIATION.md` (esp. every ⚠️LIVE marker), `HANDOFF.md`, `TRENT-DICTATION-2.md` (same dir). App context: `AGENTS.md`. Dev server: `pnpm dev` (defaults `LEDRUMS_ENGINE=voice`), run from wt-1.

**Scope discipline: Part A builds tooling; Part B is DIAGNOSIS ONLY — no fixes.** Wave 2 owns the fixes; your job is to confirm/refute each hypothesis with evidence. The single exception: trivial tooling-adjacent fixes (e.g. a broken npm script) needed to do your job.

---

## Part A — reusable UI-shot tooling (the deliverable other agents will use forever)

Goal: any agent can capture a screenshot of a route/section of the running app with ONE command and ~zero token overhead. No more per-session hand-rolled headless-chrome scripts.

- **Evaluate, then pick, and say why in the report:** (1) `shot-scraper` (Simon Willison; pip/pipx/uvx) — mature, selector-scoped, YAML multi-shot; vs (2) a thin (~100-line) JS wrapper using `playwright-core` with **`channel: 'chrome'`** (system Chrome — avoids the ~300 MB browser download; **disk is tight, ~4.7 GB free — do NOT download browser binaries if avoidable**). Bias: whichever gets a reliable one-command capture with the least install weight. Pure-JS fits the repo's no-native-addons ethos.
- **Shot catalogue:** a checked-in config (e.g. `shots.yml` / `shots.json`) naming every app surface: app shell, trigger graph canvas, node editor states (node selected → inspector), patch graph, objects view incl. Song Library section, layers/buses dock, top bar, settings dialog, envelope editor. Selector-scoped where useful. Include a `--route`/`--select` ad-hoc mode alongside named shots.
- **Wiring:** `pnpm ui-shot [name|--all]` — ensures/starts the dev server if not up, captures PNG(s) to a **gitignored** `\.ui-shots/` dir with stable filenames, prints the paths. Console errors during capture should be surfaced (a capture that loads a broken page must say so — that's the "clean console" gate made cheap).
- **Docs:** short `scripts/ui-shot/README.md` (usage in 10 lines) + add one line to `AGENTS.md` under UI rules: UI changes must be verified with `pnpm ui-shot` captures.
- Commit all of Part A to your branch. Screenshots themselves stay gitignored.

## Part B — live smoke pass (dev server up, real browser, DIAGNOSIS ONLY)

Use your new tool for captures/evidence wherever possible (it's also its own acceptance test). For each item: verdict **CONFIRMED / NOT-REPRO / ROOT-CAUSED** + evidence (file:line, console output, screenshot path).

1. **Visualiser render truth:** under `LEDRUMS_ENGINE=voice`, with link open vs closed — which layer actually feeds the visualiser pixels (server frames vs the throwaway `sim.ts`)? This decides where item B's `Math.random()` bug lives. (Reconciliation §2.)
2. **Share button / tunnel:** `store.tunnel` is empty → button self-hides (`ShareInfo.svelte:17-21`). Check server boot logs: does `tunnel-manager.ts` spawn cloudflared? Is cloudflared installed? Root-cause why no tunnel url/pin reaches the web store. Report, don't fix.
3. **LayersDock lag:** confirm the 2 Hz stat-stepping hypothesis (Reconciliation §8) by observing the dock under a voice load (fire graphs). Note whether jank matches 500 ms steps. Instrument/console-time if needed; revert instrumentation before commit.
4. **Delay-node corruption repro:** graph with a Delay node wired in → add modifier + modulation nodes (via the add modals), wire them, watch console + Delay node integrity. Try variations (Delay selected in inspector while adding). (Reconciliation §7, changeKind suspicion.)
5. **The 9 graph UX bugs** (Reconciliation §7 table): reproduce each live; confirm or amend the mechanism hypothesis. Watch specifically for `effect_update_depth_exceeded` and rAF null-derefs (the vitest-blind class).
6. **Song Library end-to-end:** left rail → Objects → Songs → Song Library. Save/name/export/import-ref/detach a song live. Confirm the closure works in the running app; capture the path with named shots.
7. **General clean-console smoke:** load every major view; zero uncaught errors is the bar. List any console noise found.

## Report

Commit `docs/plans/2026-07-03-phase2-review/WAVE1-REPORT.md` on your branch: Part A tool decision + usage one-liner; Part B per-item verdict table with evidence; a "surprises" section. Then `twux send-message --session parent --status done` with a ≤30-line summary. Master (parent) reviews the branch + merges to rock-solid.

Budget: check `twux usage`; if the 5h window is above ~85%, finish the current item, commit, and report partial rather than pushing through.
