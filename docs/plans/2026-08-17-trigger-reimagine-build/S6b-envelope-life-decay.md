# S6b — Envelope-valued life/decay: model + core/protocol/engine implementation

**Effort: opus/high · branch `feat/life-envelope` — branch off S6a's branch tip (`feat/envelope-control`),
it consumes the `CurveField` value type and component · PR into main (stacks above S6a).**
Authorised by Trent 2026-08-17 pre-AFK: "go all the way" — envelope-valued life through
core/protocol/engine overnight, model per this design. **This design section IS the model
decision record — deviations from it are escalations, not judgment calls.**

## The model (decided)

We do NOT make arbitrary effect params envelope-valued (that would ripple `number |
Envelope` unions through params, undo, modulation and the protocol for no gain tonight).
Instead ONE new optional field with a single meaning:

**`lifeEnvelope?: CurveValue` on the authored effect instance** (the same place the effect's
`params` record lives — verify the exact authored type; it's the per-node/per-layer effect
binding, not the EffectGenerator).

Semantics — the envelope is the voice's **amplitude-over-life curve**:

- `A(t)`: for voice age t (normalised over the envelope's time span T), output brightness is
  multiplied by the curve value: `t < h0.x → h0.y`; between handles → profile-interpolated
  (same pure maths as S6a's curve module — REUSE that module, do not re-implement); `t > h1.x
  → h1.y`.
- **Sustain**: when `lifeEnvelope` is present it REPLACES `resolveVoiceSustainMs`'s param
  lookup: sustain = the envelope's end-time (h1.x in real units), with the existing
  `EXP_TAIL_FACTOR`-style visibility cutoff applied when `h1.y > 0` decays via release. If
  `h1.y > 0`, the voice holds at that level until its mode ends it (loop/hold semantics
  untouched) — for oneshot voices, sustain ends at h1.x and the existing release path fades
  from `h1.y`.
- **Units**: the envelope's time span carries a unit `'ms' | 'beats'`, resolved at spawn
  exactly where `resolveVoiceSustainMs` resolves today (nothing tempo-dependent crosses the
  wire un-resolved; core stays pure — bpm comes in through the existing spawn deps).
- **Default/seeding**: absence of `lifeEnvelope` = today's behaviour, byte-for-byte (the
  #182 `voiceLife` path). The UI seeds a new envelope from the effect's current life/decay
  declaration: h0 = (0, 1), h1 = (resolved life, 0), profile `exp`, strength ≈ the effect's
  current exponential feel. Editing detaches from the scalar; the scalar param row is hidden
  from the common section while an envelope exists (it remains in the model untouched —
  removal is not tonight's business).
- **Purity**: `A(t)` evaluation lives in core as a pure function of (envelope, voiceAgeMs,
  resolvedSpanMs); the engine multiplies the effect's output level by it in ONE place (where
  per-voice level/decay envelope currently applies — find the single seam, likely
  `envelope-tick` / the voice level pipeline from #182; do not scatter multiplies per effect).
- **Sim/engine parity**: web sim and server engine share the core evaluation — verify both
  call through the same code path (this is what #182 fixed for scalar life; keep that shape).

## Protocol + persistence

- Extend the authored effect-binding schema in `packages/protocol` with optional
  `lifeEnvelope` (shape-validated: h0/h1 in-range, profile enum, strength 0..1). Stripping
  z.objects means old clients simply drop it — acceptable (two users, greenfield posture).
- It flows wherever effect params flow today: same mutation path, same undo slot, same
  server broadcast. NO new message types.

## UI wiring (thin — the layout work belongs to S4)

Bind `CurveField` (time-domain config) to `lifeEnvelope` in the effect inspector where the
life/decay scalar row renders today; seeding + detach per above. If S4 (progressive-disclosure
inspector) has landed on main by the time you integrate, put it in S4's common section; if
not, replace the existing scalar row in place and S4 will absorb it. Also: add the missing
`voiceLife` declaration to the `segments` effect (one line, `{key:'lifeBeats', unit:'beats'}`
— flagged 2026-08-16) so seeding works there.

## Anchors to verify

- #182's machinery on main: `EffectGenerator.voiceLife`, `resolveVoiceSustainMs`,
  `effects/visibility.ts` (`EXP_TAIL_FACTOR`), `envelope-tick`/voice level seam.
- The authored effect-binding type + its zod schema + any `_Lock*` compile-time locks.
- S6a's exported `CurveValue` type + pure curve-eval module.
- How `lifeBeats` resolves bpm at spawn today.

## Scope fence

May touch: `packages/core` (new pure envelope-eval usage, spawn resolution, the ONE engine
multiply seam, segments voiceLife line, tests), `packages/protocol` (schema + lock),
the effect-inspector binding site in `apps/web`, sim parity path, unit tests throughout,
design-system regen only if the styleguide renders the bound control. Non-goals: modulation
envelopes/ADSR, arbitrary envelope-valued params, changing any effect's internal decay maths,
protocol versioning, S8's velocity curve.

## Evidence

- Typecheck 0 + targeted vitest (core voice/envelope, protocol, the binding site), committed
  HEAD pushed. **Do NOT run the full `pnpm test` sweep — orchestrator-only rule; the
  orchestrator sweeps at review.**
- Core tests: A(t) at all four profiles; sustain resolution (ms + beats); absence = today's
  behaviour (regression-lock a couple of effects' voice lifetimes with and without envelope);
  oneshot release from `h1.y > 0`; loop/hold untouched.
- A frame-level test in the V1 style (the #182 diagnosis repro pattern) proving a voice's
  brightness follows the authored curve on BOTH sim and engine paths.
- ui-shot: effect inspector showing the bound envelope on a real effect — `--strict`.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- The single multiply seam doesn't exist (level application is scattered) — report the map,
  wait, rather than inventing a refactor at 3am.
- Envelope presence needs to interact with a per-effect internal decay param to avoid
  double-attenuation on specific effects — list the offenders and your proposed per-effect
  handling, wait for the orchestrator's go (the orchestrator may approve without Trent).
- Anything touches the render loop's determinism contract.
