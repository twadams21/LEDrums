# Effects Library v2 — flat orchestrator state

Live scratch state for the `elv2-orch` session. The plan doc
(`docs/plans/2026-07-05-effects-library-v2.md`) status tracker is the authoritative
per-unit record (implementers update it on land); THIS doc tracks in-flight orchestration
that isn't yet committed as landed work. A successor orch reads: handoff → plan doc → this.

## Standing orders (from handoff, non-negotiable)
- Flat orchestration; units driven directly from the plan doc.
- Implementers launch in NEW windows (no `--split`), `--effort low`, one unit per agent.
- Model routing: **Fable** U2/U4/U6 · **Opus** U1/U3/U5/U7.
- **Usage gate: at ≥92% of the 7-day window, STOP launching and AskUserQuestion Trent.**
  Check `twux usage` before EVERY launch and on every wake.
- No next unit until the current one is verified (git + gates, not pane captures).

## Execution order
`U1 → (U2 ∥ U3 ∥ U4) ; U4 → U5 → U6 ; U7 last`. Given tight weekly budget, run SERIALLY
unless Trent approves parallel spend at the gate.

## Current position (2026-07-05)
- **U1 metadata + gallery** — IN FLIGHT. Impl session `elv2-u1-c99a09` (Opus, low),
  launched from `docs/prompts/elv2-u1.md`, plan doc as extra reading. Brief committed
  `290f624`.
- Usage at launch: 7d **89%** (resets 2026-07-09T04:00+10:00), 5h 13%.
- **Expectation: hit the 92% gate right after U1.** U2/U3/U4 require Trent's explicit yes
  (asked via AskUserQuestion at the gate) OR waiting for the 7d reset on 2026-07-09.

## Units — quick status
| Unit | Model | Status | Session |
|---|---|---|---|
| U1 metadata + gallery | Opus | in-flight | elv2-u1-c99a09 |
| U2 isometric thumbs | Fable | pending (after U1) | — |
| U3 rehab + retirement | Opus | pending (after U1) | — |
| U4 canvas engine | Fable | pending (after U1) | — |
| U5 canvas UI | Opus | pending (after U4) | — |
| U6 library fill | Fable | pending (after U4/U5) | — |
| U7 close-out | Opus | pending (last) | — |

## Next action
Wait for `elv2-u1-c99a09` to report (inbox 📬). On report: verify diff + gates myself,
then check `twux usage`. If ≥92%: STOP, AskUserQuestion Trent (proceed vs pause to reset).
