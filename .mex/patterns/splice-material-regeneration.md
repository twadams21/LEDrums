# Pattern: Regenerate stateful splice material

Use this pattern when a splice cascade outlasts the authored life of hit-driven material.

## Contract

- Resolve the cycle from the effect's declared `voiceLife` key and unit. Do not use the voice-tail
  factor: it describes visibility/sustain, not the authored material period.
- Keep the cycle state in the engine-owned `GeometryState` for the voice/member. Include it in
  checkpoints and clear it with generator, model, show, and voice lifecycle resets.
- At a boundary, create fresh generator state. Derive the cycle seed and synthetic sequence from
  stable voice identity, so replaying the same event log produces the same frames.
- Derive `timeMs`, `ageMs`, `dt`, and voice transport from the same cycle clock. A wrapped clock
  with retained state is not regeneration and fails stateful effects.
- Retain at most one outgoing cycle. Render the extra generation only during a short bounded
  crossfade; ordinary frames must stay at one generator render. Run modifiers once after blend.
- Keep no-life effects on the existing path. Avoid enabling regeneration for a splice that has no
  deliberate cascade delay unless its semantics require it.

## Verification

Test at least three cycles for an absolute-time effect, a voice-timebase effect, an emitter, and a
particle effect. Assert a far partition has meaningful intensity, seeds/sequences advance, and
the result is identical on replay. Add a regression that a time-only wrap leaves state stale.
Cover no-life, modifier/scope/Mix, checkpoint restore, model/show reset, member/voice isolation,
and the one-or-two-render bound. Run the opt-in realistic benchmark and report p50/p95 against
16.7ms; include the exact machine and sample method when the result is used for a release claim.

## Current implementation seam

`packages/core/src/voice/compositor.ts` decides when a splice member needs a declared-life cycle;
`generator-bridge.ts` owns deterministic state replacement and the bounded scratch buffers;
`geometry-state.ts`, `voice-pool.ts`, and `render-checkpoint.ts` own lifetime and rollback. Keep
web preview/rendering delegated to core so parity has one implementation.
