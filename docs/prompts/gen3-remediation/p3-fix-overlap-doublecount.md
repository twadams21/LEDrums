# P3 fix — delay→Mix overlap double-count (P3 review B1 + S1 + S2 + N2)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then the review:
`docs/reports/2026-07-09-gen3-p3-review.md` (your spec of record), plus
`docs/reports/2026-07-09-gen3-r13.md` / `...-r14.md` for the model you are
fixing within. The parent spec's Phase 3 defines the intended semantics.

You own the Phase 3 review findings. In priority order:

## B1 (blocking) — release the superseded Mix voice on delayed re-composition
During the delay-overlap window the still-live member is composited twice:
the drain spawns a fresh re-composed `Mix[A,B]` voice but nothing releases
the immediate `Mix[A]` voice (poly buses never steal), and the fold's gate
(`isLayerLive(pad,'a')`) is true iff `Mix[A]` is still alive — so the
double-count is guaranteed whenever the fold fires. Fix direction from the
review: on a delayed re-composition, release/replace the prior Mix voice for
that (pad, mixNodeId) origin before spawning the re-composed one — the two
composites are one evolving timeline voice, not siblings. Keep delay-0
parity byte-identical and don't disturb genuine multiplicity (two distinct
effects into Output; rapid re-fires spawning their own voices).

## S1 — engine-level overlap test (this is B1's acceptance gate)
Add engine tests that `setShow` the delay→Mix graph, fire, tick past the
delay, and assert active-voice count / composited brightness for the
overlapping member across ticks — the seam the existing single-eval-call
tests structurally cannot observe. Cover: overlap window (no double
brightness), decayed member absent, delay-0 parity at engine level, rapid
double-fire on the same pad. Mirror what's cheap in the sim.

## S2 — liveness aliasing across trigger instances on the same pad
`isLayerLive(pad, origin)` can fold trigger #1's still-live A into trigger
#2's drain. Decide the semantics under the timeline model (aliasing may even
be correct-enough), implement or document the decision with a code comment —
the review asks for a decision, not necessarily a behaviour change. If your
B1 fix (voice replacement keyed by (pad, mixNodeId)) changes the aliasing
story, document how.

## N2 — one-line comment
In the fan-in coalescing guard: note the intentional drop of secondary
per-edge latch keys.

Scope: `packages/core/src/voice/` (+ sim mirror if needed). Core stays pure;
R13's 9 delay-timeline tests + R14's 7 fan-in tests + the Mix suite are your
regression floor. Full `pnpm gates` before reporting.

Sibling note: R27 (inspectors) and R05 (graph lint strip) are running —
stay out of the web inspector/canvas components.
