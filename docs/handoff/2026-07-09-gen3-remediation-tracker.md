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
| R26 field migration | #105 | wt-2 | gen3r/r26-field-migration | r26-field-41a9a2 | ✅ merged `d39a39a` (HEAD 388dedf; design-system.html conflict resolved by regen at merge; gates 1350 web); #105 closed; Notion Done + report; window killed. Field gained `unit` prop; out-of-scope rows documented in report (need further Field variants) |
| R14 fan-in coalescing | #93 | wt-1 | gen3r/r14-fanin-coalescing | r14-fanin-09815b | ✅ merged `e3f0c92` (HEAD 6fc0d2d; gates 1352 web, core 693); #93 closed; Notion Done + report; R18 #97 → Ready; window killed. Root cause: play draft pushed once per incoming bucket entry; fixed with per-eval-call firedEffects set |
| R04 effect auto-wire | #83 | wt-3 | gen3r/r04-effect-autowire | r04-autowire-b1ad6c | ✅ merged `5f0e7ae` (HEAD 9cdba31; gates 1358 web); #83 closed; Notion Done + report; window killed. Added batchIntoCurrentUndo store helper (reusable) |

## Wave 4 (dispatched 2026-07-09 ~06:20Z, 3 wide) — Phase 3 COMPLETE → review gate running
| Ticket | Issue | Worktree | Branch | Session | Status |
|---|---|---|---|---|---|
| R08 wire-splice | #87 | wt-3 | gen3r/r08-wire-splice | r08-splice-4b6295 | ✅ merged `dc17794` (HEAD 10412d5; gates 1378 web); #87 closed; Notion Done + report; window killed. Splice-only undo verified (two-step: wiring first, position second). Follow-up: unused trigger-node-meta import in TriggerGraphView (cleanup pass) |
| R05 lint strip | #84 | wt-3 | gen3r/r05-lint-strip | r05-lint-c8cb25 | ✅ merged `21f4724` (HEAD ec993db; gates 1383 web); #84 closed; Notion Done + report; window killed. Note: live strip is empty for authored graphs today (anchors guaranteed, cycles refused at wire time) — R06/R07 add the codes that light it up |
| R10 category chips | #89 | wt-3 | gen3r/r10-category-chips | r10-chips-7f5673 | running. R06 #85 HELD BACK: it touches the Output inspector = R27's active turf; dispatch R06 after R27 merges |
NOTE: r27 was ALSO limit-stalled (like p3-review) — resumed with a prompt ~09:25Z. Lesson: after a session-limit reset, capture-check ALL running agents, not just idle-listed ones.
| R27 anchor header | #106 | wt-2 | gen3r/r27-anchor-header | r27-header-e9cbbc | ✅ merged `f197859` (HEAD 3e0969e; design-system regen at merge; gates 1392 web); #106 closed; Notion Done + report; window killed. New AnchorHeader primitive. Follow-up: migrate TriggerSource/patch ihead to it. OPS: its first ui-shot captured a sibling worktree's :5173 server — agents must use own ports (already in CONVENTIONS; it self-corrected) |
| R10 category chips | #89 | wt-3 | gen3r/r10-category-chips | r10-chips-7f5673 | ✅ merged `3bbb613` (HEAD 0cd5529; design-system regen at merge; gates green); #89 closed; Notion Done + report; window killed. New NodeIconChip shared primitive (NodeCard refactored to use it) |

## Wave 5 (dispatched 2026-07-09 ~10:00Z, 3 wide)
| Ticket | Issue | Worktree | Branch | Session | Status |
|---|---|---|---|---|---|
| R17 sim↔core types | #96 | wt-1 | gen3r/r17-sim-core-types | r17-types-e44723 | ✅ merged `f277b48` (HEAD a16a744; gates green); #96 closed; Notion Done + report; window killed. −59 mirror lines, 3 casts gone; accepted deviation: type-only PlayDraft re-export in core barrel |
| R18 plan caching | #97 | wt-1 | gen3r/r18-plan-caching | r18-cache-7a0d36 | ✅ merged `31bf969` (HEAD eb17560; gates core 707, web 1394); #97 closed; Notion Done + report; window killed. EvalState-injected cache, parity test included |
| R20 store split 1/5 | #99 | wt-1 | gen3r/r20-store-monitor | r20-monitor-09b053 | ✅ merged `f21b5d0` (HEAD e25d4c5; gates 1394 web; controller tests unmodified); #99 closed; Notion Done + report; window killed. Engine event-log/feeds deliberately left (no seam) |
| R21 store split 2/5 | #100 | wt-1 | gen3r/r21-store-midi | r21-midi-aac79c | ✅ merged `ea27d73` (HEAD bb2fa4c; gates 1399 web; tests unmodified); #100 closed; Notion Done + report; window killed. Also filed GH #109 (MIDI architecture research) citing direct instruction from Trent — flagged for confirmation. R22 seam: undo history |
| P5 review (R25–R27) | — | wt-2 | — | p5-review-4f9592 | ✅ CLEAN (0 blocking, 0 should-fix, 3 nits). **PHASE 5 CLOSED.** Report merged `docs/reports/2026-07-09-gen3-p5-review.md`; design-system drift = minifier churn only. Window killed |
FREEZE: wt-1 + wt-2 idle (no launches). Queue: R22 #101 → R23 #102 → R24 #103 (store chain), R15 #94 (sweep — now carries P1 nits + dead-import/unused-eval candidates), R19 #98, then P4 review. R28 #107 manual (Trent)
| P2 review (R09–R12) | — | wt-3 | — | p2-review-7a86f1 | ✅ CLEAN (0 blocking). Report merged. N1 (dead drop-active class) fixed by orchestrator `0b38010` + dead trigger-node-meta import removed `5c169a4`. S1 RULED by Trent 2026-07-09: 120ms animation is FINE (contract is graph-canvas-scoped). **PHASE 2 CLOSED.** |
| R11b DnD polish | — | wt-3 | gen3r/r11b-sections-dnd-polish | r11b-polish-186e5a | ✅ merged `1b1d9ab` (HEAD 569fc64; gates 1403 web). Cyan wash root-caused: oklch border-mix hue arc passes through cyan → oklab. Custom drag image + dimmed source; vertical inter-column insert-line (columnGapIndexAt). Noted on #90; window killed. **Item 2 (drag ghost) is OS-level — needs Trent's live eyeball** |
| R30+R31 shortcuts/restyle | — | wt-1 | gen3r/r30-shortcuts-restyle | r30-polish-ce65c7 | ✅ merged `775f30a` (HEAD 5e03abd; gates 1417 web; design-system regen at merge). R30: sections restyle (Objects geometry + surface-2 thumb tiles, DnD preserved) + shortcut seam (capture-phase registry, Cmd/Ctrl+D duplicates selected node; NO redo exists in store — only undo relocated). R31: toast restyle (top-centre, per-role oklab tint) — agent says Trent drove it interactively. Window killed. Wayfinder map #110 charted (#109 research, #111 copy/paste grilling, #112 patch reframe prototype) |
BOARD IDLE under freeze (all 3 worktrees clean, no gen3 agents live). One stale week-old session S17-layersdock (lane-1 era) still alive — not this run's, left alone.
| R06 node lint badges | #85 | wt-2 | gen3r/r06-node-lint-badges | r06-badges-9e8350 | ✅ merged `d7d67ea` (HEAD c077244; gates 1399 web); #85 closed; Notion Done + report; window killed. Cross-ticket R18×R06 checked by orchestrator: cached plans' empty-scope issues can be param-stale — SAFE (non-fatal + UI compiles uncached); invariant documented on renderPlanSignature |
| R07 reachability lint | #86 | wt-2 | gen3r/r07-reachability-lint | r07-reach-a8f6a1 | ✅ merged `00695da` (HEAD 47ad16c; gates 1401 web); #86 closed; Notion Done + report; R19 #98 → Ready; window killed. **PHASE 1 tickets complete (R01–R08)** |
| P1 review (R01–R08) | — | wt-2 | gen3r/p1-review-report | p1-review-64e737 | ✅ CLEAN (0 blocking, 0 should-fix, 3 nits). All six cross-ticket invariants verified. **PHASE 1 CLOSED.** Report merged; window killed. Nits → R15-sweep candidates: (1) no reachability inspector row, (2) empty-scope cache footgun doc-only, (3) zero-displacement drag-splice leaves a no-op undo entry |
| P5 review (R25–R27) | — | wt-2 | gen3r/p5-review-report | p5-review-4f9592 | running (opus/high; preview truthfulness/ticker hygiene, Field migration fidelity, AnchorHeader dispatch ordering, design-system drift check) |
| R12 canvas drag-over | #91 | wt-3 | gen3r/r12-canvas-dragover | r12-dragover-295499 | ✅ merged `d607341` (HEAD fbad847; gates 1394 web); #91 closed; Notion Done + report; window killed. **PHASE 2 tickets complete** (R09–R12) |
| P2 review (R09–R12) | — | wt-3 | gen3r/p2-review-report | p2-review-7a86f1 | running (opus/high; affordance surface + interaction contract + DEV-rune leak checks) |
Queue: R07 #86 (after R06), R15 #94, R18 #97, R19 #98 (after 86+97), R20→R24 chain, R26 done, P1 review after R07 (R03✅ R04✅ R05✅ R08✅), P2 review after R12, P5 review after R27✅+R26✅ → ready to dispatch once a slot frees.
| P3 review (R13+R14) | — | wt-1 | gen3r/p3-review-report | p3-review-e1f2f1 | ✅ report merged. Verdict: eval-seam semantics correct, but 1 BLOCKING: delay→Mix overlap composites the still-live member TWICE (poly buses never steal; fold gate ≡ old-voice-alive). Unowned between R13/R14. Also S1 (no engine-level overlap test), S2 (liveness aliases across trigger instances), N2 (latch-key drop uncommented). Window killed. NOTE: agent stalled ~2.5h on the session usage limit mid-review — resumed post-reset with a prompt |
| P3 fix (B1/S1/S2/N2) | — | wt-1 | gen3r/p3-fix-overlap | p3-fix-b5f0c1 | ✅ merged `3ff3256` (HEAD fab0cca; gates green core 698, web 1385). Drained re-composition releases superseded (pad,mixNodeId) voice; 5 engine overlap tests (verified failing pre-fix) + 2 sim. **PHASE 3 CLOSED** (noted on #92 + Notion R13). Follow-up (non-blocking): composite re-attacks members on drain. Window killed |
| R17 sim↔core types | #96 | wt-1 | gen3r/r17-sim-core-types | r17-types-e44723 | running (mechanical type-import sweep; keeps sim re-exports so web imports stay contained) |
R05 #84 (lint strip) queued — held back to avoid canvas collision with R08. After: R06→R07, R10, R12, R15, R17, R18, R20-chain.
P1 review gate needs R05–R08; P5 review needs R27 (R25✅ R26✅).
Notion rows kept current. Gate-lock MIN bug (Tinypool min>max, found by r16) fixed in `scripts/with-gate-lock.mjs` + CONVENTIONS. r16 also flagged a dead pre-graph Block-tree evaluator in sim.ts — dead-code sweep candidate (note for R19/R15 triage).

## Decisions
- **2026-07-09 ~11:10Z: Trent — LAUNCH FREEZE.** No new agent launches until he lifts it. In-flight (R21, P5 review, R11b) run to completion and get normal closeout (merge/gates/GH/Notion); freed slots stay empty; queue accumulates (R15, R19, R22→R24, then P4 review).
- Worktree pool reused: `~/Documents/dev/ledrums-wt/wt-1..7` (wt-4..7 created for this run). wt-master untouched (rock-solid).
- Impl agents: opus/medium; R01 opus/high (diagnosis gate). New tmux windows (user directive), killed after verified completion.
- **Width cap (Trent, 2026-07-09): max 3 agents wide normally, 4 absolute ceiling.** The paused wave-1 agents (r16/r25/r29) count toward width when resumed.
- **2026-07-09 ~03:00Z: Trent dropped to 1 wide** — parallel test suites contend for system resources. **Trent is driving the agents manually; orchestrator is hands-off** (no messaging/resuming/merging/killing) until he hands control back. Orchestrator remains available for bookkeeping (Notion, tracker, merges) on request.
- Reports: committed `docs/reports/2026-07-09-gen3-r<NN>.md`, orchestrator copies into Notion row + sets Status.
