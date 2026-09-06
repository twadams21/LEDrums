# Pattern: Regenerate stateful splice material

Use this pattern when a splice cascade outlasts the authored life of hit-driven material.

## Contract

- Resolve the cycle from the effect's declared `voiceLife` key and unit. Do not use the voice-tail
  factor: it describes visibility/sustain, not the authored material period.
- Only Splice-owned members can carry a frozen `materialCycleMs`, and the compositor activates it
  only when `maxCascadeDelayMs(model, splice) > 0`. Ordinary Mix members and direct voices keep
  one continuous generator state; no cycle reset is inferred from their spawn.
- Keep the cycle state in the engine-owned `GeometryState` for the voice/member. Include it in
  checkpoints and clear it with generator, model, show, and voice lifecycle resets.
- At a boundary, create fresh generator state. Derive the cycle seed and synthetic sequence from
  stable voice identity, so replaying the same event log produces the same frames. Store the
  resolved cycle duration on the spawned member; never recalculate it from the current BPM.
- Derive `timeMs`, `ageMs`, `dt`, and voice transport from the same cycle clock. A wrapped clock
  with retained state is not regeneration and fails stateful effects.
- Snapshot and restore every mutable context carrier in `finally`: context fields, trigger
  fields, both transport objects, and the trigger-array shape. This protects the next member,
  ordinary voice, and modifier even when a generator throws.
- Retain at most one outgoing framebuffer. Render the current generation once per frame; at an
  adjacent boundary blend the fresh current output with the frozen previous output for at most
  100ms, then run modifiers once. A cycle jump greater than one starts without stale output.
- Keep no-life effects and splices without cascade delay on the existing path. Invalid or
  non-positive declared life must normalize to a positive generator/schema-compatible value.

## Verification

Test at least three cycles for an absolute-time effect, a voice-timebase effect, an emitter, and a
particle effect. Assert a far partition has meaningful intensity, seeds/sequences advance, and
the result is identical on replay. Add a regression that a time-only wrap leaves state stale.
Cover no-life, modifier/scope/Mix, checkpoint restore, model/show reset, member/voice isolation,
and the one-render-per-frame bound. Add structural performance gates for one generator render per
frame and reused hot-path carriers; do not make correctness depend on wall-clock timing. Run the
opt-in realistic benchmark only for reporting p50/p95, with warmup/sample method and machine
metadata. A no-life field effect such as Plasma is a control path, not authored regeneration.

## Current implementation seam

`packages/core/src/voice/compositor.ts` decides when a delayed splice member needs a declared-life
cycle; `generator-bridge.ts` owns deterministic state replacement, context isolation, and the
bounded current/previous frame carriers;
`geometry-state.ts`, `voice-pool.ts`, and `render-checkpoint.ts` own lifetime and rollback. Keep
web preview/rendering delegated to core so parity has one implementation.
