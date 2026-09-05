# Health P03 / P04 / P08 — core + offline runtime

Source: `docs/plans/2026-09-05-codebase-health-audit.md`; Trent's dispatch explicitly approves restart-on-geometry-edit and the follow-ups. Isolated worktree `ledrums-health-core`, branch `fix/health-core-runtime`, base `ea18f61`. No store/shows/persistence, global ROUTER/design artifact, output/IO or release changes.

## P03 — geometry ownership

`GeometryState` identifies an immutable `PixelModel` revision by object identity, not pixel count. `ensureGeometryState` resets generator/modifier state recursively for Mix and Splice members. The engine invalidates at `setModel`; the compositor also checks at render (including zero-level voices), so direct/offline adapters receive the same protection. Pool deactivation drops model references. State restarts lazily with the original seed; voice identity/age/envelope and splice motion/latches are preserved. A model edit is not a new trigger. Mutating a PixelModel in place is unsupported: supply a new object for a geometry revision.

Proof:
- `pnpm install --frozen-lockfile`: **exit 0**, lockfile unchanged.
- Red: `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-geometry.test.ts`: **9 failed / 3 passed**, stale buffers/non-finite feedback and fresh-state mismatches. The initial fixture validation failure was corrected before recording this red.
- Green: runtime geometry + compositor + Splice render + pool: **156 passed**. Matrix: Pixel Accumulation / Confetti × Feedback / Echo × ordinary / Mix / Splice; sequential grow/shrink/equal-total reorder compared with fresh-state rendering at the same voice age.
- Offline geometry regression: **1 passed**, same model-revision sequence through `Sim` + `renderFrame`.

## P04 — one generation, canonical scope, explicit modifier timing

GeneratorBridge now accepts a canonical array of pixel ranges instead of one start/end pair. Compositor sorts/coalesces adjacent and overlapping selected ranges, generates each ordinary/Mix/Splice member once, then masks its output. Scope order cannot change state advancement or double-add pixels.

`applyScopedModifierChain` shares the existing chain executor. Each `ModifierDef` now requires an explicit `scopePolicy` (`full-output` / `range-local`), independent of its gallery category. Temporal and animated-noise links operate once on the full generated/assembled output with the real dt; their state is full-output, NOT range-local. Other links operate independently per contiguous selected run, with separate state per run. Stale run-state entries are removed. Chain order remains authored order. Adjacent selected hoops form one spatial run; disconnected runs never wrap spatial content across their gap. For ordinary generators, temporal history includes generated content outside the final mask. For composites, history sees their assembled buffer. Final masking always prevents output outside scope. No dt=0 hack.

Red: scoped regressions **21 failed / 3 passed** (plus benchmark passed) before repair. Green: **249 targeted tests**, then **25 scope regressions + benchmark**. Real spatial test uses Slide with nonzero offset; temporal test instruments Echo to prove one full-output apply per frame with dt=16 and dark unselected pixels. Core `tsc --noEmit` passes. Close-out review found that Grain/Sparkle have temporal state despite their **texture** gallery category: two added red tests observed 8 applies instead of 4 across disjoint ranges. Explicit execution policy closes that hole; final scope suite **27 passed**, plus **79 modifier compatibility tests**. Flicker's seeded noise also uses the full-output domain. The P04 commit was amended locally to include this policy (the earlier draft `bba2532` is superseded by `17c97fb9`).

### Reproducible synthetic benchmark

Host: Intel i9-9880H / x86_64, Node v25.8.2, pnpm 9.12.0, Vitest 2.1.9.

Command (both versions): `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-scope.test.ts src/voice/runtime-scope.benchmark.test.ts`. Baseline is P03 `6bf599e` with the new benchmark file, before changing the scope implementation. Fixed 1,024 pixels; 1/4/16 hoops, all selected; Pixel Accumulation, fixed ids/seeds/time, 100 warm-up + 500 measured ticks, dt=16. Timing includes effective-param resolution + compositor; generator calls instrumented with the same wrapper on both runs.

| Voices | Hoops | Calls/tick before → after | p50 ms before → after | p95 ms before → after |
|---:|---:|---:|---:|---:|
| 1 | 1 | 1 → 1 | 0.0447 → 0.0436 | 0.0850 → 0.0952 |
| 1 | 4 | 4 → 1 | 0.0518 → 0.0383 | 0.1221 → 0.0649 |
| 1 | 16 | 16 → 1 | 0.1484 → 0.0490 | 0.2451 → 0.1065 |
| 16 | 1 | 16 → 16 | 0.4013 → 0.5070 | 0.5702 → 1.1347 |
| 16 | 4 | 64 → 16 | 0.6893 → 0.2983 | 1.2860 → 0.6177 |
| 16 | 16 | 256 → 16 | 2.2577 → 0.3249 | 4.2962 → 0.6371 |

These are single synthetic runs on a shared development host, alongside the scope test file; timings are noisy (including a slower 1-hoop/16-voice case), not latency/percentage promises. Operation counts are the deterministic result. No allocation profiler was run: each avoided bridge call avoids its merged-param object and whole-model generator work, but net allocation bytes/GC are **not measured**. Benchmark has no timing threshold. Close-out added an opt-in guard so normal tests skip the timing workload; reproduce now with `LEDRUMS_HEALTH_BENCH=1 pnpm --filter @ledrums/core exec vitest run src/voice/runtime-scope.benchmark.test.ts` (or include the scope test file to match the original run shape). The opt-in command and default skip were both verified.

## P08 — offline adapter, not another renderer/pool

The offline renderer's ~400-line generator/Mix/Splice/modifier copy is replaced with a final RGBA→RGB quantization adapter. `Sim` owns an instance of the **core compositor and core VoicePool**, and uses core envelope advance/reap, release, member seed/materialization, cascade shaping and latched-motion policies. The last two policies were extracted from the engine, which also delegates to them. No third rendering/lifetime implementation remains. Member buffers remain float until final output, fixing intermediate byte rounding/alpha loss as well as the missing downstream modifiers.

Core pool stealing now clears latches pointing to the retired identity before slot reuse (reaping already did). The fixed **256 parent-voice** cap and deterministic policy are shared: free slot, otherwise oldest releasing voice, otherwise oldest overall; equal birth times retain the core's stable slab-order tie break. Saturation does not allocate additional voice slots. Composite member seeds now use the actual core recipe, replacing the divergent offline XOR recipe.

`Sim` retains the browser-specific responsibilities: relative `tick(dt)`, BPM/beat/time-signature fields, live input tables, graph trigger/evaluation context, pending-fire schedule and authored section-look recall. Those adapters are deliberately not replaced by a second server-input resolver. Existing delayed overlap/timeline/fan-in, life-envelope, generator and Splice tests remain green. Latched motion now advances **after** reaping, matching core (no extra movement on a voice's death tick).

### Repaint ownership

Reading the existing store (unchanged) showed that it renders on every rAF **while paused**, and requests immediate renders between ticks on a hit. Reusing `lastDt` on each repaint would keep advancing trails while time stands still. New red regression reproduced changing bytes on the second repaint. `Sim.render` now memoizes the current tick's float output by tick revision + model identity. Twenty repeated paints render the generator **once**, with no state advance; the next real tick invalidates the frame. A new model invalidates even without a tick. New voices start at level zero and become visible on the next tick, preserving the previous immediate-hit contract. No repeated-render dt=0 workaround is used.

### Before/after correctness

| Probe | Before | After |
|---|---|---|
| Geometry replacement during Feedback/Echo and seeded generators | 9/12 initial matrix cases fail; non-finite/stale output | 12/12 pass; same model retains state, replacements recreate it; fresh-state frame parity |
| Each ordinary/Mix/Splice generator, 1/4/16 selected hoops | Render/state advance per range | One render per tick, including **disjoint** four-hoop selection on fixed 16-hoop geometry |
| Mix/Splice → Levels, Slide, Echo, or Slide→Feedback→Levels | All 8 initial byte-replay cases fail | Every replay frame byte-identical to core |
| 1,025 poly loop hits | 1,025 offline voices | 256, IDs/slab order agree with core; replay seeds deterministic |
| Stolen toggle latch | Old core latch still points at retired `v1`; offline voice never stolen | Latch cleared; toggle re-fires the new identity and next hit releases it |
| Paused repaint | Same tick's RGB changes again | Same bytes, one generator call across 21 paints |

Additional replay coverage: Mix/Splice × Feedback/Echo model grow/shrink/equal-total reorder stays finite and byte-identical; latched Splice release → dark gap → second hit agrees frame by frame. Initial P08 replay run: **10 failed** before reuse; pool retirement regression separately red; paused repaint separately red. Final new focused regressions: **57 tests** (40 core + 17 web), plus one opt-in benchmark.

## Verification commands and results

No full-package test sweeps or workspace sweeps were run. All commands execute in this worktree.

1. Core runtime: `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-pool.test.ts src/voice/runtime-geometry.test.ts src/voice/runtime-scope.test.ts src/voice/voice-pool.test.ts src/voice/compositor.test.ts src/voice/splice.render.test.ts src/voice/engine.test.ts src/voice/engine.delay-overlap.test.ts src/voice/envelope.test.ts src/voice/life-envelope.test.ts` — **297 passed** on the final source. The final scope-policy close-out additionally passed **106 tests** (27 scope + 79 modifier compatibility).
2. Modifier executor compatibility: `pnpm --filter @ledrums/core exec vitest run src/modifiers/modifiers.s30.test.ts src/modifiers/modifiers.s31.test.ts src/modifiers/modifiers.s32.test.ts` — **79 passed** (included in the 249-test P04 run).
3. Offline adapter: `pnpm --filter @ledrums/web exec vitest run src/lib/trigger-lab/runtime-parity.test.ts src/lib/trigger-lab/render.geometry.test.ts src/lib/trigger-lab/generator-bridge.test.ts src/lib/trigger-lab/sim.splice.test.ts src/lib/trigger-lab/sim.life-envelope.test.ts src/lib/trigger-lab/sim.modifiers.test.ts src/lib/trigger-lab/sim.modulation.test.ts src/lib/trigger-lab/sim.delay.test.ts src/lib/trigger-lab/sim.delay-overlap.test.ts src/lib/trigger-lab/sim.delay-timeline.test.ts src/lib/trigger-lab/sim.gen3-parity.test.ts src/lib/trigger-lab/sim.fanin-coalescing.test.ts` — **81 passed**.
4. Types: `pnpm --filter @ledrums/core typecheck` and `pnpm --filter @ledrums/core exec tsc --noEmit -p tsconfig.health-runtime.json` — **exit 0**. The latter explicitly checks the owned web runtime and relevant test entrypoints, not the whole web/Svelte app. Initial temporary-config attempt lacked Vite's ImportMeta declaration; the committed narrow config includes it.
5. `git diff --check` — clean. Source review: no Node/DOM/IO imports or ambient randomness added to core runtime. No visuals/styles/design artifacts changed. No screenshots, hardware certification, PR/push/merge/deploy or release actions; integrated screenshots and sweep belong to the orchestrator.

## State-worker handoff / limits

- Existing `new Sim(buses, effects, presets)`, `tick`, trigger/stop/section APIs and `pixelModel = newModel` remain valid. `pixelModel` is now an accessor that invalidates visual state immediately. **Replace the Sim on document replacement** (P01), then assign current geometry, tempo and buses as before. No store changes are needed for normal calls.
- **`Sim.voices` is now a read-only active view of pooled core voices**; do not clear it with `sim.voices = []` or retain a slot as an immutable snapshot. Use a new Sim for document reset, and copy data if it must outlive slot reuse. `stopAll()` still means a release/fade, not document replacement. The exported view-facing `Voice` type preserves optional pool bookkeeping for existing dock fixtures.
- New `Sim.render(PixelModel)` returns a reused read-only float buffer; `renderFrame`'s signature is unchanged. Core exposes pool/envelope/cascade helpers under `voice`; the internal GeneratorBridge changed from start/end to range-array input. New modifier implementations must declare `scopePolicy`; all existing registry entries are updated (no state-worker adaptation needed). No persisted schema, protocol, show or store interfaces changed. There was no web `generator-bridge.ts` at this base; its implementation was in the now-replaced `render.ts`, with `generator-bridge.test.ts` retained.
- Geometry revisions must be new objects, including equal-total edits. Trails/particles restart, but voice age/envelope and latched motion do not restart or gain extra cascade lifetime retroactively. This is state invalidation, not a new hit or trail remapping.
- Full-output temporal state can consume more memory than a narrowly scoped ring; spatial per-run state and composite members also scale with model/graph size. The 256 cap is not a byte budget or a cap on composite members. Allocation/GC profiling, larger models/256-voice performance matrix, hardware timing and connected↔offline history replay are not certified here. The offline adapter still renders lazily; skipped connected-preview frames are not replayed when it resumes. No new scrubbing API was invented: existing time/transport ownership remains in the browser adapter.

Local logical commits: P03 `6bf599e`; P04 `17c97fb9`; P08 is the commit containing this completed report. The report records the ownership/rationale and verification for the orchestrator's GROW/integration pass; global scaffold files were intentionally untouched per dispatch.
