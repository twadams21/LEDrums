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
- **U1 metadata + gallery — DONE & VERIFIED by orch.** Commits `2093a77`, `8dce68b`,
  `d998e54`, `8f60453`. Typecheck clean; clean-sweep tests green (core 584 / io 51 /
  protocol 1 / server 227 / web 1174). New core: `vocabulary.ts`, `metadata.ts`,
  `aliases.ts` (empty map) + `aliases.test.ts`. Registry test enforces desc+tag+collection.
  Session `elv2-u1-c99a09` (parked/idle). U1 flagged: the 10 legacy pattern effects still
  show untagged in the gallery → U3 retires them.
- **U3 rehab + retirement — IN FLIGHT.** Impl session `<PENDING launch>` (Opus, low), from
  `docs/prompts/elv2-u3.md`. Populates the alias map + deprecates retired effects, emission-
  lifts the Lift row, implements the locked merges, DELETES `pattern-renderer.ts`.
- **Budget reality:** U1 cost ~1% weekly (89→90%). ~2% headroom before the 92% gate; 7d
  resets 2026-07-09T04:00+10:00. Can fit ~1-2 more units before the gate → strategy:
  finish independent gallery units (U3 now, then U2 if budget) BEFORE the gate; defer the
  canvas-engine chain (U4→U5→U6) + U7 to post-reset or Trent's explicit go past 92%.
- Usage after U1: 7d **90%**, 5h 22%.

## Units — quick status
| Unit | Model | Status | Session |
|---|---|---|---|
| U1 metadata + gallery | Opus | DONE (verified) | elv2-u1-c99a09 |
| U2 isometric thumbs | Fable | pending (after U1) | — |
| U3 rehab + retirement | Opus | in-flight | (launching) |
| U4 canvas engine | Fable | pending (after U1) | — |
| U5 canvas UI | Opus | pending (after U4) | — |
| U6 library fill | Fable | pending (after U4/U5) | — |
| U7 close-out | Opus | pending (last) | — |

## Trent decisions (2026-07-05, at the 91% gate)
- **EffectCreator → REMOVE** (option a): delete EffectCreator + createEffect/NewEffectInput;
  custom authoring moves to the Canvas engine in U5. (Pattern path deletion, locked dec 2,
  obsoletes it — plan grep-list had missed this dependency.)
- **Budget → PROCEED PAST 92%** (explicit yes; standing order #4 satisfied). Keep driving
  units serially. Still report progress; no hard stop at 92% now — but stay sane near the
  95% twux refusal and near the 5h window.

## Serial constraint (not just budget)
U3's physical deletion edits `EffectThumb` (removing pattern branches); U2 rewrites
`EffectThumb` (isometric painter). They COLLIDE → U2 must not start until U3 fully lands.

## Next action
Direct idle `elv2-u3-29924d` to finish the physical deletion (remove EffectCreator; delete
pattern-renderer.ts + Pattern plumbing + EffectThumb/render.ts branches; rework ~1100 lines
of core determinism tests → generator voices, DON'T weaken assertions; UI rules for the
EffectCreator removal; tracker → done). Verify, then launch U2 (Fable, thumbnails).
