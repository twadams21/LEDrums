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
| U2 isometric thumbs | Fable | DONE (verified) | elv2-u2-5f49b4 |
| U3 rehab + retirement | Opus | DONE (verified) | elv2-u3-29924d |
| U4 canvas engine | Fable | DONE (verified) | elv2-u4-e3855d |
| U5 canvas UI | Opus | BLOCKED at 95% wall | — |
| U6 library fill | Fable | pending (after U4/U5) | — |
| U7 close-out | Opus | pending (last) | — |

## U2 DONE — verified by orch (2026-07-05)
Commits 1d7398f, c81d68c, e649bd0. Gates green (typecheck clean; core 586 / web 1184 [+10
projection tests] / server 227 / io 51 / protocol 1). Eyeballed u2-gallery.png: isometric
¾-angle glowing-dot drums, kit-wide effects show the background mini-drum (Whole Kit / 3D
Radial Wash / 3D Wipe), consistent camera. EffectThumb prop API UNCHANGED → TriggerNode.svelte
NOT re-touched (still just U3's change). QA: 58 cards pixel-sampled × ~36 phases, 0 black/
frozen/errors. Deviations (accepted): (a) ClipSettings 84×46 has NO live UI entry point on
main (dead overlay — nothing calls store.openSettings); size covered by projection tests.
(b) shots.json named shot 'effect-gallery' is broken independent of U2 (its 'Take over'
click times out) — BOTH U3 and U2 hit it → worth a shots.json fix later (follow-up, not in
scope). No new design-system primitive (painter internal to EffectThumb) → no regen needed.
Usage after U2: 7d 93%, 5h 55%.

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

## U3 DONE — verified by orch (2026-07-05)
Commits 11ef0b1, 6d2e589, 2465b90, a5341f3. Gates green (typecheck clean; core 586 / web
1174 / server 227 / io 51). Determinism rework spot-checked = genuine (source swapped
pattern→geometry-uniform generator, assertions intact; core count 584→586, not gutted).
`pattern-renderer.ts` + `EffectCreator.svelte` deleted; grep zero pattern refs. The
compositor now has ONE render path (generator-only). Usage after U3: 7d 92%, 5h 41%.

⚠️ **TRENT'S WIP TOUCHED:** U3 edited `apps/web/src/lib/app/views/TriggerNode.svelte` —
the pattern deletion changed EffectThumb's prop API, so U3 updated its `playThumb`
EffectThumb call (dropped `pattern`/`triggered`/`triggerAt`, added `generatorId`/
`labModel`). Left UNSTAGED. Reported to me as "one line" but it's a 4-prop rewrite; can't
verify Trent's original WIP survived from git. FLAGGED to Trent — his to confirm.

## Post-U3 API note for downstream units
EffectThumb is now GENERATOR-ONLY (no pattern branch). Public prop API: `generatorId`,
`labModel`, `params`, `w`, `h`. kit.ts SoA `attrs` + `hueToRgb` were removed by U3. U2
must PRESERVE EffectThumb's prop API (so it never forces another edit to Trent's
TriggerNode.svelte); if it must change the API, flag the orch — do NOT edit Trent's WIP.

## U4 DONE — verified by orch (2026-07-05)
Commits bf3b1fa, b498bf3, 6176708, 9665bce, 83c6a3e, 04958db. Gates green (typecheck clean;
core 625 [+35 canvas tests] / web 1187 / server 227 / io 51). **NO-FORK PROVEN by git:**
`git log bf3b1fa^..HEAD -- compositor.ts generator-bridge.ts` is EMPTY — scene engine is a
pure EffectGenerator adapter, zero compositor/bridge edits. field.ts → canvas/sampler.ts (12
texture callers re-anchored, locked dec 7). Full canvas module: types/scene/elements(6 pure
renderers)/sampler(4 samplers)/lenses(8 incl hyper4d)/registry + 6 test files. Golden
stripes+polar==rings real (exact toBeCloseTo math). Determinism: byte-identical replays for
canvas + mixed canvas/hosted show. Perf: 0.536 ms/frame on real 548px kit (budget 5ms).
Working tree clean (TriggerNode untouched). Deviation (accepted): the "confetti bench" my
brief referenced doesn't exist as a committed file — U4 mirrored engine.test.ts perf
structure instead (fine). Usage after U4: 7d **95%**, 5h 79%.

## ⛔ HARD STOP — 95% WEEKLY WALL (awaiting Trent)
twux REFUSES launches at ≥95% (--force overrides). U5 launch is now blocked. I will NOT
--force past 95% without Trent's EXPLICIT yes (told him this). 7d resets 2026-07-09
04:00+10:00 (~Thu). 5h resets 13:00 today but that does NOT lower the 7d wall.
DECISION PENDING (AskUserQuestion sent): PAUSE until Thu reset (resume U5→U6→U7 with full
budget) vs --force U5-U7 now (risks blowing past 100% weekly, throttling Trent's own usage
for ~4 days). Orch recommends PAUSE. On PAUSE: arm `twux wake --at <Thu reset>`, GROW, done.

## Next action (superseded — U4 done)
U4 (Fable, canvas engine — THE BIG ONE) launching — brief `docs/prompts/elv2-u4.md`. It's a
core build (scene engine as EffectGenerator adapter, NO compositor fork; field.ts → canvas
module; 6 renderers, 4 samplers, scene params, 8 lenses, determinism + <5ms perf bench).
⚠️ BUDGET WATCH: 7d at 93%, twux HARD-REFUSES launches at 95%. U4 is big; if weekly hits ~95%
during/after U4, the next launch (U5) will be refused — pause + `twux wake --at <Thu reset>`
or ask Trent to --force (I will NOT --force past 95% without his explicit yes). U4 may be the
last unit before a natural pause. After U4 (verified): U5 (Opus canvas UI) → U6 (Fable fill)
→ U7 (Opus close-out). Follow-ups noted: shots.json 'effect-gallery' broken; ClipSettings
dead overlay.
