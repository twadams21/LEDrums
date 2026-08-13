# V1 — Voice life follows the effect's own Life param

**Source:** Trent's bug report 2026-08-14 ("the life / decay of any effect doesn't seem to be
having an effect"), diagnosed by a read-only agent with a frame-level repro; orchestrator
decided the fix shape. **Base:** branch `fix/voice-life-envelope` off `origin/main` (engine
bug, ships independently of the chrome stack). PR → `main`. Your pool worktree is fine —
`git checkout -b fix/voice-life-envelope origin/main` in it.

## The confirmed mechanism (verify the anchors, then build)

- `apps/web/src/lib/trigger-lab/fixtures.ts:74-82` — `CATEGORY_ENV`, fixed
  attack/sustain/release per `EffectCategory`, baked onto every `EffectDef` at registry build
  (`fixtures.ts:118-136`); `'trigger'` ≈ 410ms total, `'particle'` ≈ 630ms.
- `packages/core/src/voice/voice-pool.ts:196-198` — spawn copies those envelope numbers;
  `slot.params` (line 193) separately carries `lifeBeats`/`lifeMs`. Never reconciled.
- `packages/core/src/voice/envelope-tick.ts:12-33` — drives `v.level` purely from
  attack/sustain/release; never reads `v.params`. Repro: life=8 beats (4000ms @120bpm) voice
  reaped at 450ms; death time identical for ANY life value.
- Effects' own fade math (e.g. `chase-bands.ts:60` `fade = 1 - ageBeats/lifeBeats`) therefore
  never gets to finish; `compositor.ts:214` skips the voice once level ≤ 0.003.
- Affected: all `'trigger'`-category emissions (chase-bands, drum-sonar, scan-plane,
  ripple-3d) and `'particle'` ones (orbit-comet, gravity-drops) — check the full registry for
  every effect with a `lifeMs`/`lifeBeats`-like param.

## The fix (decided — the declarative seam)

1. An effect impl that owns an internal life param **declares it**, in core, next to its
   `paramSpec` — shape yours, but it must express: which param, and its unit (`ms` | `beats`;
   beats convert at the voice's spawn BPM, matching how the effect itself converts).
2. **`voice-pool.spawn` derives the envelope** for such effects from the INSTANCE's params at
   spawn time: sustain ≈ the declared life (so the voice outlives the effect's own fade),
   attack/release keep the category values (the internal fade has already reached ~0 by
   release, the short tail is fine). Effects with no declaration keep `CATEGORY_ENV`
   behaviour exactly as today.
3. Registry/web plumbing (`fixtures.ts`, and check `sim.ts:542` + `show-builder.ts:59`) pass
   the declaration through; both the offline sim and the server engine get the fix from core.
   Verify the wire (`Show`/protocol types) — if the declaration lives on the effect IMPL in
   core and spawn resolves it from the registry by effect id, nothing new needs to cross the
   wire; prefer that. If it must travel on `EffectDef`, protocol zod moves with it.
4. Loop-mode voices: verify the interaction (envelope-tick line 28 uses bus crossfade for
   non-oneshot) — the declaration should not break loops; scope it to oneshot if that's the
   honest boundary, and say so.
5. **Do NOT** widen `CATEGORY_ENV` globally, and do not touch each effect's internal fade
   math — the bug is the reconciliation, fix it once at spawn.

Bonus (small, in scope): the params UI already knows units (`unit: 'beats'`) — make sure the
Life sliders visibly show their unit so beats-vs-seconds confusion dies with the bug.

## Evidence + report

Core unit tests in lockstep: a spawned voice with declared life outlives its internal fade
(the diagnostic repro as a real test — voice alive at t=0.9×life, reaped after), beats↔ms
conversion at non-default BPM, undeclared effects byte-identical to today (regression), loop
voices unaffected. Verify LIVE in your worktree (free ports; 5373/4323/9102 = preview,
4341/4342/9110 + segfx's pool ports may be busy): chase-bands life long vs short must look
different on the preview canvas — that IS the acceptance, screenshot both. Gates green on
committed HEAD, twux push, PR → main. Report: sha, PR, the declaration shape you chose, every
effect you annotated, test delta, shots.

## Escalation triggers

- The declaration can't stay core-side (registry-resolved) and something must cross the
  protocol — flag before building it.
- Deriving sustain from params at spawn conflicts with how any effect self-modulates life
  mid-voice (if such a thing exists).
- Memory/perf concern: long-life voices now actually live seconds — if the pool's voice
  budget makes that a problem (check pool sizing), report rather than silently capping.
