# P3 fix — delay→Mix overlap double-count (review B1 + S1 + S2 + N2)

Branch `gen3r/p3-fix-overlap`. Spec of record: `docs/reports/2026-07-09-gen3-p3-review.md`
(B1 blocking, S1/S2 should-fix, N2 nit), within the R13/R14 temporal model.

## What changed

### B1 (blocking) — release the superseded Mix voice on a delayed re-composition
A delayed drain into a Mix folds the still-live earlier member (A) back into a fresh
re-composed `Mix[A,B]` voice, but nothing released the *immediate* `Mix[A]` voice —
poly buses never mono-steal, and the fold is gated on `isLayerLive(pad,'a')`, which is
true **iff** `Mix[A]` is still alive. So A was guaranteed composited **twice** for the
whole overlap window (double brightness), worse than pre-R13.

Fix: the Mix evaluator flags a drained re-composition (`seen.size > 0` with the overlap
machinery on) with `PlayAction.supersedePriorVoice`. On spawn, the voice pool releases
the **oldest still-live** voice matching `(pad, originNodeId=mixNodeId)` before spawning
the re-composed one — the two composites are one evolving timeline voice, not siblings.
Uses `releaseVoice` (the mono-steal path's release), so the superseded composite fades
out as the re-composed one takes over. Immediate and `delay 0`-inline folds
(`seen.size === 0`) set no flag, so delay-0 parity and genuine multiplicity (rapid
re-fires, distinct effects into Output) are untouched.

- `eval-graph.ts` — `PlayAction.supersedePriorVoice`; set on the drained Mix composite.
- `voice-pool.ts` — `spawn` releases the prior `(pad, originNodeId)` voice when flagged.
- `sim.ts` — mirrors the flag on its local `PlayAction` and the release in `spawn` (poly bus).

### S1 — engine-level overlap test (B1's acceptance gate)
New `packages/core/src/voice/engine.delay-overlap.test.ts` (5) drives the real engine
(`setShow` → fire → tick past the delay) — the voice-pool/compositor seam the single-
eval-call R13/R14 tests structurally can't observe. Covers: overlap window (no double-
count — active-voice count 1, not 2, and composited frame matches a no-delay `Mix[A,B]`
baseline), decayed member absent, delay-0 parity at the engine level (byte-identical
frame), rapid double-fire (multiplicity preserved). Verified failing pre-fix (the two
double-count assertions flip to count 2) and passing post-fix.
Sim mirror: `sim.delay-overlap.test.ts` (2), also verified failing pre-fix.

### S2 — liveness/supersession aliasing across trigger instances (decision + comment)
`isLayerLive` and the supersession key on `(pad, originNodeId)` only — they cannot tell
which trigger instance's voice is live. **Decision:** accept the aliasing under the
timeline model — a pad's Mix node carries a single evolving composite timeline, so a
delayed drain folds/supersedes by `(pad, mix-node)` regardless of instance, releasing the
**oldest** still-live composite at that key (the most likely predecessor of this evolving
timeline). Bounded, not a stale-params leak (folds are gated on live voices; the snapshot
map is engine-owned, reset on `setShow`). Documented in `eval-graph.ts` (mix case) and
`voice-pool.ts` (spawn).

### N2 — fan-in latch-drop comment
One-line comment at the fan-in coalescing guard noting the intentional drop of secondary
per-edge latch keys (one voice ⇒ one latch; mirrors the Mix collector).

## Root cause
The immediate composite and the drained re-composition are the same evolving timeline
voice, but the drain spawned a *sibling* instead of replacing the predecessor — and poly
buses have no steal path to release it. Keying release on `(pad, mixNodeId)` origin makes
the drain evolve the single composite.

## Tests / gates
`pnpm gates` green: **core 698** (+5) · io 54 · protocol 1 · server 229 · **web 1380**
(+2) · desktop 6. Typecheck 0 errors (tsc + svelte-check). R13's 6 delay-timeline +
R14's 5 fan-in + the 17-test Mix suite (core) and their sim mirrors all still pass.

## Deviations & follow-ups
- The re-composed voice re-attacks its members' envelope (the composite has one level); the
  release/replace crossfade smooths the transition, but a staggered N-member Mix re-attacks
  the composite on each drain. Acceptable per the review's "release/replace … spawn the
  re-composed one" direction; a future "in-place member add" would avoid re-attack entirely.
- No GH issue / R-number was assigned for this P3 fix in the brief; report named to match
  the review (`…-p3-fix-overlap.md`).

## Files touched
`packages/core/src/voice/{eval-graph,voice-pool}.ts`,
`apps/web/src/lib/trigger-lab/sim.ts`,
+ 2 new tests (`packages/core/src/voice/engine.delay-overlap.test.ts`,
`apps/web/src/lib/trigger-lab/sim.delay-overlap.test.ts`).
