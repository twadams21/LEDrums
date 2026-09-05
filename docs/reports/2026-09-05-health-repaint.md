# Paused repaint correctness and bounded checkpoint allocation

Source: independent P03/P08 review of the approved health implementation, followed by the orchestrator's failing 64 MiB-per-tick allocation probe. This preserves the resumed worker's evidence; independent final review and combined gates are tracked in `2026-09-05-health-integration-review.md`.

State: committed as `e5543b1d` (`fix(runtime): reuse checkpoint payloads and journal Echo ring writes`) on the integration branch, preserving 88df4597; disjoint parent/server commits arrived during work. Commit verified to contain exactly the six owned core files; subsequent server edits remain unstaged/untouched by this slice. No push, PR, merge, deployment, dependency install or full sweep. The untracked parent report `docs/reports/2026-09-05-health-integration-review.md` was neither edited nor staged. Preserved and completed the prior agent's allocation probe.

## Implementation / review seams

- `packages/core/src/voice/render-checkpoint.ts`: retain one baseline per live slab-object + id/seed/birth generation, refresh it on ordinary ticks, restore it on same-tick dirty presentations. Prune absent/inactive voices; discard on immutable model replacement. Replace/trim composite-member snapshots by member identity.
- General copying recycles ONLY backing buffers, of exact matching length, from the previous checkpoint or current live state. Source-reachable buffers are excluded from spares. Rebuild small JS wrappers/descriptors/maps/sets, retaining cycles/view offsets/alias topology; fork both PRNG carriers, reject unsupported opaque carriers and self-returning function forks. No unbounded/high-water buffer pool; absent/resized payloads fall out of ownership.
- `ModifierDef.createCheckpoint` is an explicit, full-output-only, single-apply undo contract. Echo declares its own journal: preserve the overwritten ring slot plus cursor, keep the other 63 slots live/read-only, and restore repeatedly in place. No state-shape inference: the parent's unregistered Echo-shaped fixture uses the generic FULL copy.
- Generator registry adapter changes discard retired generator checkpoint payloads before copying/restoring. No dt=0 changes, playing-only render gate, Sim/store/show/UI/server edits, or lifecycle/eval RNG rewinds.

## Deterministic allocation / copy evidence

Original command (from packages/core):
`pnpm exec vitest run src/voice/runtime-checkpoint-allocation.test.ts`

Before: exact parent fixture, 16 voices × 4096 pixels × Echo64-shaped history, initialized states, capture tick 0 then ticks 1–3: **201,326,592 new ArrayBuffer bytes**, expected 0. Failure log `/tmp/sa28-allocation-before.log` (403 ms entire test on this rerun).
After: **0 new payload bytes** for those three ordinary ticks AND three same-tick restores.

Completed meter also intercepts ArrayBuffer / typed-array constructors and native slice methods; its self-test proves allocations through all three paths are counted, views are not. Actual solid-colour + Echo and solid-colour + Feedback rendering both allocate **0 payload bytes after warm-up**, for three ordinary presentations + three dirty restores. Each copies exactly **6,291,456 bytes total = 1 MiB per capture/restore** across all 16 voices. Scalar modifier render reads/writes are not counted as checkpoint-copy bytes.

Payload ownership at this fixture size (excludes geometry, scratch/destination framebuffers and JS objects):
- Echo: 64 MiB live ring + **1 MiB undo**, versus 64 + 64 MiB previously. Checkpoint traffic is 1 MiB per tick (roughly 60 MiB/s at 60 Hz), plus another 1 MiB per dirty restore, versus 64 MiB each before.
- Feedback: 1 MiB live accumulator + 1 MiB checkpoint. Full accumulator copying remains necessary; allocations, not its 1 MiB copy, are eliminated.
- The unregistered Echo-shaped fallback intentionally retains 64 + 64 MiB and still copies 64 MiB per capture/restore. It gets payload reuse, not the registered Echo journal's bandwidth saving.

## Actual render profiling

Repro command:
`LEDRUMS_HEALTH_BENCH=1 pnpm --filter @ledrums/core exec vitest run src/voice/runtime-checkpoint.benchmark.test.ts`

Same fixture before/after: real solid-colour generator + actual Echo/Feedback + compositor; 16 independent voices, 4096 pixels, dt 16 ms, 10 warm-up + 80 measured samples. Dirty timing measures the same-tick rerender only (its first presentation is outside that sample). Timing assertions are deliberately absent. Benchmark is opt-in, following the existing health benchmark convention.

Machine observed: Trent’s MacBook Pro, Intel i9-9880H @ 2.30 GHz, Node v25.8.2. Shared development machine, not isolated CPU/hardware-output latency or an SLA certification.

| Modifier / mode | Before median / p95 ms | After median / p95 ms |
|---|---:|---:|
| Echo, plain render (control) | 10.296 / 11.305 | 10.511 / 10.921 |
| Echo, ordinary presentation | 39.367 / 51.977 | 11.106 / 14.077 |
| Echo, dirty rerender | 41.019 / 49.530 | 10.090 / 14.479 |
| Feedback, plain render (control) | 12.226 / 12.837 | 12.126 / 15.636 |
| Feedback, ordinary presentation | 13.421 / 16.728 | 12.467 / 13.171 |
| Feedback, dirty rerender | 13.082 / 13.870 | 12.222 / 18.117 |

Logs: `/tmp/sa28-timing-before.log`, `/tmp/sa28-timing-after.log`.

## Scoped gates

- **244 core tests** across checkpoint/allocation, runtime geometry/pool/envelope/scope and modifier suites: `/tmp/sa28-core-targeted.log`.
- **105 web runtime tests**, run from `apps/web`: runtime-parity, render.geometry, generator-bridge, sim.splice, sim.life-envelope: `/tmp/sa28-web-runtime.log`. Includes 88df4597's dirty input/tempo/canvas registry/removal/re-registration/resume checks and composite decay coverage.
- **2 actual-render timing tests**, opt-in benchmark (above).
- Core `pnpm exec tsc --noEmit`: green, `/tmp/sa28-core-types.log`.
- Scoped web runtime types: `pnpm exec tsc --noEmit -p packages/core/tsconfig.health-runtime.json`: green, `/tmp/sa28-web-types.log`.
- `git diff --check`: green.

Added regressions include 145 ticks / two Echo ring wraps with variable dt, delay, brightness, bypass, empty scope and level gates; alias splitting/rejoining, cyclic Map/Set graphs and view offsets; independent callable/class RNG cursors; dead/absent/reused/replaced voice generations; removed/replaced composite members; equal-count/grow/shrink geometry; registry payload retirement; no Echo duck typing.

## Limits / parent next action

1. This is not zero-JS-allocation rendering: small object graphs, maps, sets, array/view wrappers and forked RNG closures are rebuilt. Generic state still incurs a full payload copy each capture/restore. Only Echo has sparse journaling.
2. Lazy initialization, state shape/geometry/generation/registry changes may allocate. Actual rendering warms first state creation, then its first initialized checkpoint; the supplied preinitialized probe warms in one tick-0 capture. A dirty presentation of the initial null-state baseline can still re-run lazy initialization until the first subsequent tick. This preserves 88df's cold-state semantics rather than introducing a second initialization path.
3. Echo's journal is valid because the scoped full-output contract invokes apply once and Echo mutates only one slot plus its cursor. Future Echo changes that write additional history or replace the ring must update the journal and its tests. It owns state exclusively; it is not a standalone immutable full-state snapshot.
4. The synthetic 16-voice workload itself still takes ~10–12 ms without checkpoints. Removing checkpoint overhead does not certify an 8 ms end-to-end frame SLA; p95 noise is visible on the shared host.
5. Parent must review before merge and own integrated sweep/GROW. Shared `.mex` scaffolds and parent report were left outside this slice's ownership fence. Suggested sourced GROW fact: checkpoint storage is now generation/model bounded and payload-reusing, with Echo's explicit single-slot journal; point future perf investigations at the opt-in benchmark and allocation test. No new product requirement was inferred.
