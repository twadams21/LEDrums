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

## Wave 1 (dispatched 2026-07-09 ~02:34Z; Trent capped width at 4 — normally 3)
| Ticket | Issue | Worktree | Branch | Session | Status |
|---|---|---|---|---|---|
| R01 wire bug | #80 | wt-1 | gen3r/r01-wire-bug | r01-wire-490f49 | running |
| R02 toasts | #81 | wt-2 | gen3r/r02-system-toasts | r02-toasts-a57c1c | running |
| R09 add-pane search | #88 | wt-3 | gen3r/r09-add-pane-search | r09-search-e4130d | running |
| R11 sections DnD | #90 | wt-4 | gen3r/r11-sections-dnd | r11-dnd-5e6af3 | running |
| R16 delete legacy eval | #95 | wt-5 | gen3r/r16-delete-legacy-eval | r16-eval-413010 | PAUSED by Trent (width cap) — resume when a slot frees |
| R25 signal previews | #104 | wt-6 | gen3r/r25-signal-previews | r25-previews-7be5d4 | PAUSED by Trent (width cap) — resume when a slot frees |
| R29 pixlite password | #108 | wt-7 | gen3r/r29-pixlite-admin-password | r29-pixlite-d31856 | PAUSED by Trent (width cap) — resume when a slot frees |

## Queued next (frontier once wave-1 merges)
R05 #84 (after R01 — graph surface), R10 #89 (after R09), R12 #91 (after
R11+R01), R13 #92 (after R16), R27 #106 (after R25), R20 #99 (after
R01+R02), R03 #82 (after R01+R02), R04 #83 (after R01+R02), R15 #94
(independent — dispatch when usage allows).

## Merge log
(orchestrator appends: ticket → merge sha → gates → issue closed → Notion Done)

## Decisions
- Worktree pool reused: `~/Documents/dev/ledrums-wt/wt-1..7` (wt-4..7 created for this run). wt-master untouched (rock-solid).
- Impl agents: opus/medium; R01 opus/high (diagnosis gate). New tmux windows (user directive), killed after verified completion.
- **Width cap (Trent, 2026-07-09): max 3 agents wide normally, 4 absolute ceiling.** The paused wave-1 agents (r16/r25/r29) count toward width when resumed.
- **2026-07-09 ~03:00Z: Trent dropped to 1 wide** — parallel test suites contend for system resources. **Trent is driving the agents manually; orchestrator is hands-off** (no messaging/resuming/merging/killing) until he hands control back. Orchestrator remains available for bookkeeping (Notion, tracker, merges) on request.
- Reports: committed `docs/reports/2026-07-09-gen3-r<NN>.md`, orchestrator copies into Notion row + sets Status.
