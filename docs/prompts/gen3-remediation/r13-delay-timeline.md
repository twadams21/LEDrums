# R13 — Delay = timeline shift: overlap-based Mix composition (GH #92)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 92 -R twadams21/LEDrums`, then the parent spec's Phase 3.1 +
3.3 (`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`). **Tests first** —
the spec mandates it for this ticket.

Semantics to build: a delayed layer behaves like a clip shifted on a
timeline. Composition membership at a Mix node is **temporal overlap at
render time**, not eval-batch membership. When the delayed layer starts, it
composes with whatever upstream layers are still live, per the Mix node's
blend rules; decayed layers are simply absent. `delay 0` must be
indistinguishable from no delay (parity test). Applies to the core voice
evaluator (`packages/core/src/voice/`) and the offline sim — note the sim
now **delegates Gen3 eval to core** (R16 just landed: `sim.evalGraph`
normalizes + calls `voice.evalGraph`), so get the semantics right in core
and the preview follows.

Also in scope: the Mix inspector documents the canvas y-order stacking rule
(plain copy in the Mix node's inspector), so layer order is discoverable.

Relevant prior art: the delay node's pending-fire queue (`computeDelayMs`,
engine `tick()` drain, `voice/delay.ts`), the Mix per-edge input handles,
`compositor.ts`. Sibling note: R14 (fan-in coalescing) is queued behind you
and will be defined against your settled temporal model — don't implement
coalescing here.

Core stays pure and deterministic (no wall clock, no RNG outside the seeded
paths). Acceptance criteria are on the issue.
