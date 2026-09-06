import { expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { defaultParams } from './types';
import { sparkler } from './impl/sparkler';
import { flameFlicker } from './impl/flame-flicker';

it.runIf(process.env.LEDRUMS_EFFECT_BENCH === '1')('reports 2,320-pixel all-drum fire-effect render timing', () => {
  const model = buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 40, hoopCount: 10, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums: Array.from({ length: 4 }, (_, i) => ({
      id: `d${i}`, diameterIn: 18.25, hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
  const transport = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
  const ctx: RenderContext = {
    model,
    timeMs: 90,
    dt: 16,
    transport,
    triggers: model.drums.map((drum, index) => ({
      seq: index + 1, drumId: drum.drumId, note: 38, velocity: 1, timeMs: 0, ageMs: 40,
    })),
  };
  for (const effect of [sparkler, flameFlicker]) {
    const fb = new Framebuffer(model.pixelCount);
    const state = effect.createState!(model, 123);
    const params = defaultParams(effect.paramSpec);
    for (let i = 0; i < 20; i++) {
      fb.clear();
      effect.render(ctx, params, fb, state);
    }
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      ctx.timeMs = i * 16;
      fb.clear();
      const start = performance.now();
      effect.render(ctx, params, fb, state);
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const meanMs = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    const p95Ms = sorted[Math.floor((sorted.length - 1) * 0.95)]!;
    console.log(JSON.stringify({ effect: effect.id, pixels: model.pixelCount, activeDrums: model.drums.length, meanMs, p95Ms }));

    const maxMeanMs = Number(process.env.LEDRUMS_EFFECT_BENCH_MAX_MEAN_MS);
    if (Number.isFinite(maxMeanMs)) expect(meanMs, `${effect.id} meanMs`).toBeLessThanOrEqual(maxMeanMs);
    const maxP95Ms = Number(process.env.LEDRUMS_EFFECT_BENCH_MAX_P95_MS);
    if (Number.isFinite(maxP95Ms)) expect(p95Ms, `${effect.id} p95Ms`).toBeLessThanOrEqual(maxP95Ms);
  }
});
