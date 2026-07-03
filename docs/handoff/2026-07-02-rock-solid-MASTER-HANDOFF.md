# Rock Solid — MASTER ORCH HANDOFF (read this FIRST after a compaction)

**You are the master orchestrator for the "Rock Solid" initiative** (GitHub issues #46–#57, 49 vertical slices). This doc lets you resume cold. Read, in order: **this file → `docs/handoff/2026-07-02-rock-solid-tracker.md` (live state) → `docs/plans/2026-07-02-rock-solid/ORCHESTRATION.md` (operating manual, rev 2) → `docs/plans/2026-07-02-rock-solid/slices/INDEX.md` (slice plan)**. You are a twux-launched session (`TWUX_SESSION_ID=rock-solid-master-4091b2`). twux is on PATH; you drive lanes/impls via `twux` (never raw tmux). All git work is via `git -C <worktree>` — NEVER touch your own cwd (the shared main tree, dirty with Trent's unrelated desktop/tauri work, on `main`).

## 🎯 IMMEDIATE STATE (2026-07-03 ~09:15 UTC)

- **Progress: 39/49 slices merged** into `rock-solid` (HEAD **75ea23f**, == origin). Lanes **1, 2, 3 COMPLETE** (groups A,B,E,F,G,H,I,J,K). Full sweep green: typecheck 0; **1763 tests / 0 skips** (io 13 · core 542 · protocol 1 · server 190 · web 1017).
- **🛑 LANE 4 IS ON HOLD (Trent).** The only remaining lane — Lane 4 = C→D→L (desktop shell #48, kit geometry #49, PixLite #56; 10 slices S06–S11, S46–S49). **DO NOT launch the Lane 4 orch until Trent explicitly says go** — he paused it to "chat about stuff first." Await Trent.
- **⏳ PENDING WITH TRENT:** Trent said "we'll compact after you've written the doc" — i.e. a compaction is expected right after this doc. When you resume, the next real input is Trent's chat (likely about Lane 4 scope). Do not auto-act on Lane 4.
- **No lane orch or impl is currently running.** Only the master (you) is alive. Killed-but-resumable: lane-1-b0cea3, lane-2-988e46, lane-3-c9f2bf, fix-graph-palette-30094a (all `twux resume --session <id>` if needed — not normally needed; git + reports are the audit trail).

## What just happened (recent, not yet in the tracker's older snapshots)

1. **Side-task MERGED (Trent direct request), not a slice:** trigger-graph palette redesign + OSC. Merge **75ea23f** on rock-solid. Delivered: (a) pointer-events fix (palette no longer blocks the canvas horizontally); (b) Modifier + Modulation add collapsed to single top-bar buttons + type-picker **modals** (`GraphAddMenu.svelte`; `ModifierPalette.svelte` retired); "one palette" per Trent; (c) **OSC modulation** as a `cc`-source toggle — new optional `GraphNode.ccSource?: 'midi'|'osc'` + `oscAddress?` (back-compat, absent→midi), core stays pure, +208-line `modulation-osc.test.ts`. Report: `docs/handoff/rock-solid/fix-trigger-graph-palette-report.md`. I reviewed (core purity ✓, back-compat types ✓, full sweep ✓) before merging.
2. Earlier same session: a **P0 hotfix** (6d19f14) — modulation node-face preview froze the whole app (self-referential `$effect` → `effect_update_depth_exceeded`, halts Svelte effects app-wide → all clicks dead; + rAF null-deref). Trent confirmed fixed. **Lesson (below).**
3. **Trent's styling** (eb97243) 3-way merged onto rock-solid (component CSS: focus ring, graph handle, NodeCard, segmented/slider/tooltip).

## LOCKED policies (apply to Lane 4 + any further work)

- **⚙️ Effort/cost (Trent directive, overrides ORCHESTRATION.md's opus/xhigh row):** impls default **opus/MEDIUM**; **high** only for tracer / ui-significant / tricky engine-persistence seams; **NEVER xhigh**. Compensate with a STRICTER per-slice orch review (full diff read before every merge; defects bounced back). Followers get **only the slice file + predecessor tracer report** (not the mechanism doc). **All launches own windows, never split panes.** Slim reports **≤30 lines**. (Proven: Lanes 2-3 caught ~9 real defects pre-merge, zero rework, ~⅓ the xhigh burn.) **You MUST bake this into the Lane 4 orch's send-message assignment** (lane orchs still read ORCHESTRATION.md which says xhigh).
- **Integrate-before-handoff:** each lane orch merges latest `rock-solid` into its group branch + resolves BEFORE handing off, so master merges are clean (design-system.html conflicts → regenerate via `pnpm design-system`, never hand-merge the generated file).
- **UI/effect group review MUST include a LIVE APP SMOKE-LOAD** (`pnpm dev`, clean console — no `effect_update_depth_exceeded`, no uncaught rAF throws). Unit tests are blind to effect loops + animation-frame lifecycle races (that's how the P0 shipped). **Non-negotiable for Lane 4's S48 controller-panel UI and any effect-heavy group.**
- **Budget:** stop NEW launches at `twux usage` 5h ≥ 70% (leave Trent ~30% headroom); let in-flight finish; `twux wake --at <reset>` and resume 24/7. Trent can override by telling you. twux's own 85/90/95 gates are the hard backstop.
- **Escalation:** only the master contacts Trent, and ONLY via **AskUserQuestion**, for blocking product decisions / the final gate. Everything else → the tracker.
- **Master context discipline:** at the START of every wake, write current state to the tracker BEFORE acting. Keep tracker + this doc + ORCHESTRATION.md always sufficient for a successor.

## Topology

- **Integration branch `rock-solid`** (off `main`@ca0d70c, pushed). Merges to `main` ONLY at the final gate, WITH Trent.
- **Worktrees** (`git worktree list`): `wt-master` = rock-solid (master's — tracker commits + group merges + post-merge sweeps here). Pool `wt-1/2/3` for impls. **⚠️ wt-2 is currently left on the stale merged `group/K` branch — detach it (`git -C ../ledrums-wt/wt-2 checkout --detach rock-solid`) before reusing.** wt-1, wt-3 are detached-clean.
- Group branch = `group/<letter>` off rock-solid (lane orch creates); slice branch = `slice/S##` off the group (impl creates). Assign a pool worktree per slice only when `git -C <wt> status --porcelain` is EMPTY.
- **Disk: ~4.7 GB free (99% full), down from 8.3 GB at start.** MONITOR closely for Lane 4 — tauri `target/` builds are NOT hardlinked and are large. `df -h /Users/trent` before/around desktop builds; ENOSPC = blocking escalation to Trent.

## HOW TO RESUME LANE 4 (only after Trent says go)

1. Ensure 5h usage < 70% (`twux usage`); if not, `twux wake --at <reset>` and resume then.
2. Detach wt-2 (see above) so the pool is clean.
3. `twux launch --name lane-4 --role orch --doc docs/plans/2026-07-02-rock-solid/ORCHESTRATION.md --read docs/plans/2026-07-02-rock-solid/slices/INDEX.md --model fable --effort high` (own window).
4. `twux send-message --session <lane-4 id>` the assignment: **Lane 4 = C (#48, S06–S08) → D (#49, S09–S11) → L (#56, S46–S49)**, in order. Deps (INDEX): C: S07/S08 need S06; D: S11 needs S10; L: S47 needs S46, S48 needs S47 + S03 (done ✓), S49 needs S48. Include ALL locked policies above (effort/cost, integrate-before-handoff, cwd-safety, live-smoke-load for UI, WATCH DISK for tauri builds, pool wt-1/2/3, hand each reviewed+integrated group to master, budget 70%).
5. Then master cadence: `twux wake --in 30m`, verify lane alive/progressing, merge each handed-off group into rock-solid (wt-master, `--no-ff`) + full sweep + push, update tracker each wake.

## AFTER Lane 4 (the finish)

- **Pre-final-gate cross-lane seam review** (recommended, master runs it): one Fable reviewer over the seams between lanes — routing↔looks↔modulation authority, modifier↔modulation wiring, library↔clipboard closure.
- **FINAL GATE (blocking, via AskUserQuestion):** `rock-solid` → `main` merge + the consolidated live spot-check (browser + hardware). NEVER autonomous.

## Key lessons captured (also in tracker ESCALATIONS/notes)

- **Svelte $effect self-reference class of bug — HIT TWICE (NodeSignalPreview 6d19f14, ParamRowTick 6c4bc06):** the colour-token effect idiom was copy-pasted; each read+wrote `c`. SWEPT `git grep "read('--[a-z-]+', *c\."` → both fixed, SignalFace clean, no instances remain. **Recommended guard (follow-up): extract the theme-token read into ONE shared helper so no component hand-rolls it.**  an `$effect` that reads AND writes the same `$state` (bit us twice — NodeSignalPreview + ParamRowTick; both fixed, idiom swept) → `effect_update_depth_exceeded` → Svelte halts effect flush app-wide → delegated `onclick` dies everywhere (hover/drag/keyboard survive). Also null-guard anything a rAF ticker samples via a reactive getter (nodes can be deleted a frame before). Vitest can't catch either → live smoke-load required.
- **Cross-group merge drift:** group branches forked before a sibling merged → semantic conflicts in shared files. Mitigation = integrate-before-handoff (above).
- **Non-blocking future-slice residuals** from group reports (G/H/I/J) are listed in the tracker notes — surface to Trent post-initiative, NOT in scope for Rock Solid.
