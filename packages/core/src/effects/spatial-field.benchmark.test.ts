import { expect, it } from 'vitest';
import { spatialField } from './impl/spatial-field';
import { spatialFieldReference } from './spatial-field-reference';
import { createSpatialFixture, spatialBenchmarkModel, spatialHit } from './spatial-field-fixture';
import type { EffectGenerator } from './types';

/** PARENT-OWNED, opt-in only. Do not make wall time a correctness/SLA gate.
 *
 * LEDRUMS_SPATIAL_BENCH=1 pnpm --filter @ledrums/core exec vitest run \
 *   src/effects/spatial-field.benchmark.test.ts --maxWorkers=1 --minWorkers=1
 *
 * No installs, server, devices or output. Frozen reference provenance is recorded in
 * spatial-field-reference.ts. Both sides use the same 2,300-pixel model, contexts, clear,
 * palette/framebuffer path, deterministic ages, warmup count and sample count. Alternate
 * AB/BA order to reduce (not eliminate) thermal/order bias on an older Intel host.
 *
 * Steady own-hit snapshots hold emission age=120ms with dt=0 deliberately: otherwise a
 * warmed looping voice expires its only wave and quietly benchmarks the no-wave path.
 * Phase/time still advances identically. This measures renderer cost, NOT real input latency
 * or full compositor/presentation-checkpoint cost. Cold-state construction is reported
 * separately (cache-build cost must not be hidden behind warm numbers). Rich-mode overhead
 * needs its own comparison; old/new default parity is the performance comparison here.
 */
it.runIf(process.env.LEDRUMS_SPATIAL_BENCH === '1')('reports matched Spatial Field baseline/candidate costs', () => {
  const model = spatialBenchmarkModel();
  const warmup = 80;
  const samples = 300;
  const metadata = { node: process.version, platform: process.platform, arch: process.arch,
    pixels: model.pixelCount, warmup, samples, dtMs: 0, units: 'ms/batch',
    referenceCommit: 'efbf269230ba23c77e1adbc243b059c0b59835e4' };
  const hit = [spatialHit(1, 'd0', 120, 1)];
  for (const scenario of [
    { name: 'warm-base', voices: 1, waves: false, cold: false },
    { name: 'warm-own-hit', voices: 1, waves: true, cold: false },
    { name: 'warm-eight-voices', voices: 8, waves: true, cold: false },
    { name: 'cold-own-hit-including-state', voices: 1, waves: true, cold: true },
  ]) {
    const make = (generator: EffectGenerator) => {
      const fixtures = Array.from({ length: scenario.voices }, () => createSpatialFixture(generator, model));
      for (const fixture of fixtures) fixture.render(0, 0, scenario.waves ? hit : []);
      let checksum = 0;
      return {
        run(time: number) {
          for (const fixture of fixtures) {
            const current = scenario.cold ? createSpatialFixture(generator, model) : fixture;
            const fb = current.render(time, 0, scenario.waves ? hit : []);
            checksum += fb.rgba[(Math.floor(time) % model.pixelCount) * 4]!;
          }
        },
        checksum: () => checksum,
      };
    };
    const before = make(spatialFieldReference), after = make(spatialField);
    for (let i = 0; i < warmup; i++) { before.run(i * 16); after.run(i * 16); }
    const baseline: number[] = [], candidate: number[] = [];
    const measure = (runner: typeof before, time: number, into: number[]) => {
      const start = performance.now();
      runner.run(time);
      into.push(performance.now() - start);
    };
    for (let i = 0; i < samples; i++) {
      const time = (warmup + i) * 16;
      if (i % 2) { measure(after, time, candidate); measure(before, time, baseline); }
      else { measure(before, time, baseline); measure(after, time, candidate); }
    }
    expect(after.checksum()).toBe(before.checksum());
    const stats = (times: number[]) => {
      const sorted = times.slice().sort((a, b) => a - b);
      const rank = (p: number) => sorted[Math.ceil(p * sorted.length) - 1]!;
      return { mean: times.reduce((sum, v) => sum + v, 0) / times.length, p50: rank(0.5), p95: rank(0.95) };
    };
    console.log(JSON.stringify({ ...metadata, scenario, baseline: stats(baseline), candidate: stats(candidate) }));
  }
});
