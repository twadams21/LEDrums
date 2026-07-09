# Gen3 UX remediation — orchestration tracker

Orchestrator state doc. Updated BEFORE acting on each wake. Authoritative
completion record is the Notion DB "Gen3 UX Remediation Tickets"
(`collection://199954bb-9870-48eb-b3c6-c3c81a496d7a`); GH issues close on
merge. Integration branch: `codex/gen3-graph-authoring`.

## Dependency map (from issue bodies)
- P1 Graph trust: R01 #80 · R02 #81 → R03 #82 (80,81) → R08 #87 (82); R04 #83 (80,81); R05 #84 → R06 #85 → R07 #86
- P2 Affordances: R09 #88 · R10 #89 (serialize after R09: same pane) · R11 #90 · R12 #91 (serialize after R11+R01: rows + canvas)
- P3 Engine: R13 #92 → R14 #93 (serialize R13 after R16: same area)
- P4 Code health: R15 #94 (independent sweep) · R16 #95 → R17 #96 · R18 #97 (92,93) · R19 #98 (86,97) · R20 #99 → R21 #100 → R22 #101 → R23 #102 → R24 #103 (chained god-file split; start R20 after R01/R02 merge)
- P5 Inspector: R25 #104 → R26 #105 · R27 #106 (serialize after R25: same area)
- HW: R28 #107 (MANUAL — Trent, real hardware) · R29 #108

## Phase-review gates
When a phase's tickets are all Done → `/twux rev` agent running `/code-review`
scoped to that phase's merged range; fix findings before closing the phase.

## Wave 1 (✅ CLOSED OUT 2026-07-09 ~04:15Z)
All four running tickets merged, gates green, GH issues closed, Notion Done
with reports pasted. Sessions killed (resumable via registry). The three
over-wide launches (r16/r25/r29) never started work — Trent exited their
sessions; worktrees wt-4..7 removed, their unstarted branches deleted;
tickets returned to the queue for re-dispatch ≤3 wide via wt-1..3.

## Merge log
- R01 #80 → merge `4512714` (branch HEAD c1d1b85). Root cause: Mix-node per-edge handle set missing from projection signature → stale flow-node reuse → wire had no measured handle until refresh. 2 regression tests.
- R02 #81 → merge `1d8f436` (HEAD 8d0657e). System-action toast seam: core normalize returns actions summary → hydrate batches → one toast at normalizeGraphs.
- R09 #88 → merge `da3f8a4` (HEAD daa035a). Add-pane search across all categories; ui-shot strict clean; design system regenerated.
- R11 #90 → merge `e45da99` (HEAD 173e469). Sections DnD insertion line + section-target outline; dev-only preview rune for ui-shot. Conflict in `shot-seam.ts` vs R09 (both additive) — unioned by orchestrator.
- Baseline debt cleared post-merge in `2994f0a`: `node-options.test.ts:156` cast → `NodeKind[]`; `SectionsView` `.title-icon` → `:global` under `.title`. Typecheck now 0 errors / 0 warnings (2435 files); full suite 1321 web + all packages green.
- GH: #80 #81 #88 #90 closed with merge refs. Notion: 4 rows Done + commit shas + report bodies; R03 #82 + R04 #83 flipped Blocked→Ready.

## Queued next (current frontier, dispatch ≤3 wide into wt-1..3)
R03 #82, R04 #83 (both newly Ready), R05 #84, R10 #89, R12 #91, R13 #92,
R15 #94, R16 #95, R20 #99, R25 #104, R27 #106, R29 #108. R28 #107 is a
MANUAL hardware gate for Trent. Phase-review gates unchanged (P1 needs
R03–R08; P2 needs R10+R12).
Suggested next wave (disjoint): R16 (core/sim eval delete) + R25
(inspectors) + R29 (io/settings) — the original paused trio.

## Test-run contention — SOLVED (approved by Trent, landed `6c9eb2d`)
`pnpm gates` = typecheck + full suite behind a machine-wide lock
(`scripts/with-gate-lock.mjs`, ~/.ledrums/locks, stale-steal). Vitest workers
bounded via VITEST_MAX_FORKS/THREADS (defaults set inside the lock; agents cap
scoped runs at 2). CONVENTIONS.md mandates `pnpm gates` for final verification.
Also landed `8b72b50`: ui-shot presets removed (agents must capture ad-hoc via
--state/--target; presets = locked CI baselines only — rule added to
CONVENTIONS.md after wave-1 agents registered three out of habit).

## Wave 2 (dispatched 2026-07-09 ~04:30Z, 3 wide, off `8b72b50`)
| Ticket | Issue | Worktree | Branch | Session | Status |
|---|---|---|---|---|---|
| R16 delete legacy eval | #95 | wt-1 | gen3r/r16-delete-legacy-eval | r16-eval-415ced | ✅ merged `f30918f` (−627 lines, gates green via lock); #95 closed; Notion Done; R17 #96 → Ready; window killed |
| R25 signal previews | #104 | wt-2 | gen3r/r25-signal-previews | r25-previews-a61432 | ✅ merged (HEAD ea2f0a8; merged gates green 1333 web); #104 closed; Notion Done + report; window killed. Follow-up flagged: `nid()` id collisions vs persisted graphs (latent, breaks select-by-id) — sweep candidate |
| R29 pixlite password | #108 | wt-3 | gen3r/r29-pixlite-admin-password | r29-pixlite-11270e | ✅ merged `8c5576a` (UI→server-hash→transport auth; merged gates green); #108 closed; Notion Done; window killed |
| R03 connection validation | #82 | wt-3 | gen3r/r03-connection-validation | r03-validation-855f6a | ✅ merged `00701b0` (HEAD 980e47c; merged gates green 1350 web); #82 closed; Notion Done + report; R08 #87 → Ready; window killed |
| R13 delay timeline | #92 | wt-1 | gen3r/r13-delay-timeline | r13-timeline-18ae74 | ✅ merged `55274ad` (HEAD 2d5e397; merged gates green 1336 web; shot-seam conflict vs R29/R25 unioned by orchestrator); #92 closed; Notion Done + report; window killed. Follow-up flagged: headless ui-shot of a WIRED-Mix inspector throws `validateDrag is not defined` from xyflow (identifier nowhere in source) — pre-existing, needs triage |

## Wave 3 (dispatched 2026-07-09 ~05:50Z, 3 wide)
| Ticket | Issue | Worktree | Branch | Session | Status |
|---|---|---|---|---|---|
| R26 field migration | #105 | wt-2 | gen3r/r26-field-migration | r26-field-41a9a2 | running |
| R14 fan-in coalescing | #93 | wt-1 | gen3r/r14-fanin-coalescing | r14-fanin-09815b | running (opus/high — core temporal semantics; defined against R13's model) |
| R04 effect auto-wire | #83 | wt-3 | gen3r/r04-effect-autowire | r04-autowire-b1ad6c | running |
Phase 3 (R13+R14) completes with R14 → dispatch P3 review agent then. P1 review needs R03✅–R08 (R05→R06→R07 chain + R08 still queued).
Notion rows kept current. Gate-lock MIN bug (Tinypool min>max, found by r16) fixed in `scripts/with-gate-lock.mjs` + CONVENTIONS. r16 also flagged a dead pre-graph Block-tree evaluator in sim.ts — dead-code sweep candidate (note for R19/R15 triage).

## Decisions
- Worktree pool reused: `~/Documents/dev/ledrums-wt/wt-1..7` (wt-4..7 created for this run). wt-master untouched (rock-solid).
- Impl agents: opus/medium; R01 opus/high (diagnosis gate). New tmux windows (user directive), killed after verified completion.
- **Width cap (Trent, 2026-07-09): max 3 agents wide normally, 4 absolute ceiling.** The paused wave-1 agents (r16/r25/r29) count toward width when resumed.
- **2026-07-09 ~03:00Z: Trent dropped to 1 wide** — parallel test suites contend for system resources. **Trent is driving the agents manually; orchestrator is hands-off** (no messaging/resuming/merging/killing) until he hands control back. Orchestrator remains available for bookkeeping (Notion, tracker, merges) on request.
- Reports: committed `docs/reports/2026-07-09-gen3-r<NN>.md`, orchestrator copies into Notion row + sets Status.
