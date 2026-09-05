import { expect, it, vi } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { getEffect } from '../effects/registry';
import { applyEffectiveParams, createDefaultCompositor } from './compositor';
import { runtimeFrame, runtimeHoopModel, runtimeVoice } from './runtime-test-fixtures';

// Deliberately explicit opt-in by filename; no performance thresholds or % assertions.
// Same 1,024 pixels, 100 warm-up + 500 sampled ticks, dt=16, deterministic seeds.
it('reports scoped render work and tick timing (synthetic, not hardware latency)', () => {
  const rows: object[] = [];
  for (const voices of [1, 16]) for (const hoops of [1, 4, 16]) {
    const model = runtimeHoopModel(hoops);
    const vs = Array.from({ length: voices }, (_, i) => runtimeVoice({
      id: `v${i + 1}`, seed: i + 1, scope: 'hoop',
      targetId: `d0#${Array.from({ length: hoops }, (_, h) => h + 1).join(',')}`,
    }));
    const c = createDefaultCompositor();
    const fb = new Framebuffer(model.pixelCount);
    const gen = getEffect('pixel-accum');
    const render = gen.render;
    let calls = 0;
    const spy = vi.spyOn(gen, 'render').mockImplementation((...args) => { calls++; return render(...args); });
    const samples: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      if (tick === 100) calls = 0;
      const time = tick * 16;
      const frame = runtimeFrame(time);
      const start = performance.now();
      for (const v of vs) applyEffectiveParams(v, time, 120);
      c.render(vs, model, frame, fb);
      if (tick >= 100) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    rows.push({ voices, hoops, pixels: model.pixelCount, callsPerTick: calls / 500,
      p50Ms: +samples[250]!.toFixed(4), p95Ms: +samples[475]!.toFixed(4) });
    spy.mockRestore();
    expect(samples).toHaveLength(500);
  }
  console.log(JSON.stringify(rows, null, 2));
}, 60_000);
