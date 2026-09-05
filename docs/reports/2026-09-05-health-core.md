# Health P03 / P04 / P08 — core + offline runtime

Source: `docs/plans/2026-09-05-codebase-health-audit.md`; Trent's dispatch explicitly approves restart-on-geometry-edit and the follow-ups. Isolated worktree `ledrums-health-core`, branch `fix/health-core-runtime`, base `ea18f61`. No store/shows/persistence, global ROUTER/design artifact, output/IO or release changes.

## P03 — geometry ownership

`GeometryState` identifies an immutable `PixelModel` revision by object identity, not pixel count. `ensureGeometryState` resets generator/modifier state recursively for Mix and Splice members. The engine invalidates at `setModel`; the compositor also checks at render (including zero-level voices), so direct/offline adapters receive the same protection. Pool deactivation drops model references. State restarts lazily with the original seed; voice identity/age/envelope and splice motion/latches are preserved. A model edit is not a new trigger. Mutating a PixelModel in place is unsupported: supply a new object for a geometry revision.

Proof:
- `pnpm install --frozen-lockfile` (required locked install).
- Red: `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-geometry.test.ts`: **9 failed / 3 passed**, stale buffers/non-finite feedback and fresh-state mismatches. The initial fixture validation failure was corrected before recording this red.
- Green: runtime geometry + compositor + Splice render + pool: **156 passed**. Matrix: Pixel Accumulation / Confetti × Feedback / Echo × ordinary / Mix / Splice; sequential grow/shrink/equal-total reorder compared with fresh-state rendering at the same voice age.
- Offline geometry regression: **1 passed**, same model-revision sequence through `Sim` + `renderFrame`.

## P04 — one generation, canonical scope, explicit modifier timing

GeneratorBridge now accepts a canonical array of pixel ranges instead of one start/end pair. Compositor sorts/coalesces adjacent and overlapping selected ranges, generates each ordinary/Mix/Splice member once, then masks its output. Scope order cannot change state advancement or double-add pixels.

`applyScopedModifierChain` shares the existing chain executor. Temporal links operate once on the full generated/assembled output with the real dt; their state is full-output, NOT range-local. Other links operate independently per contiguous selected run, with separate state per run. Stale run-state entries are removed. Chain order remains authored order. Adjacent selected hoops form one spatial run; disconnected runs never wrap spatial content across their gap. For ordinary generators, temporal history includes generated content outside the final mask. For composites, history sees their assembled buffer. Final masking always prevents output outside scope. No dt=0 hack.

Red: scoped regressions **21 failed / 3 passed** (plus benchmark passed) before repair. Green: **249 targeted tests**, then **25 scope regressions + benchmark**. Real spatial test uses Slide with nonzero offset; temporal test instruments Echo to prove one full-output apply per frame with dt=16 and dark unselected pixels. Core `tsc --noEmit` passes.

### Reproducible synthetic benchmark

Command (both versions): `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-scope.test.ts src/voice/runtime-scope.benchmark.test.ts`. Baseline is P03 `6bf599e` with the new benchmark file, before changing the scope implementation. Fixed 1,024 pixels; 1/4/16 hoops, all selected; Pixel Accumulation, fixed ids/seeds/time, 100 warm-up + 500 measured ticks, dt=16. Timing includes effective-param resolution + compositor; generator calls instrumented with the same wrapper on both runs.

| Voices | Hoops | Calls/tick before → after | p50 ms before → after | p95 ms before → after |
|---:|---:|---:|---:|---:|
| 1 | 1 | 1 → 1 | 0.0447 → 0.0436 | 0.0850 → 0.0952 |
| 1 | 4 | 4 → 1 | 0.0518 → 0.0383 | 0.1221 → 0.0649 |
| 1 | 16 | 16 → 1 | 0.1484 → 0.0490 | 0.2451 → 0.1065 |
| 16 | 1 | 16 → 16 | 0.4013 → 0.5070 | 0.5702 → 1.1347 |
| 16 | 4 | 64 → 16 | 0.6893 → 0.2983 | 1.2860 → 0.6177 |
| 16 | 16 | 256 → 16 | 2.2577 → 0.3249 | 4.2962 → 0.6371 |

These are single synthetic runs on a shared development host, alongside the scope test file; timings are noisy (including a slower 1-hoop/16-voice case), not latency/percentage promises. Operation counts are the deterministic result. No allocation profiler was run: each avoided bridge call avoids its merged-param object and whole-model generator work, but net allocation bytes/GC are **not measured**. Benchmark has no timing threshold and can be run alone by filename.

## P08

Implementation pending in the next logical commit. No full sweeps, browser screenshots, hardware certification or publish actions are performed by this worker; integrated screenshots belong to the orchestrator.
