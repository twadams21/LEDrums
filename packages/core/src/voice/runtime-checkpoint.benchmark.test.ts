import { expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeVoice } from './runtime-test-fixtures';

// Opt-in diagnostic timings, not a machine-speed gate. Identical before/after fixture:
// LEDRUMS_HEALTH_BENCH=1 pnpm --filter @ledrums/core exec vitest run src/voice/runtime-checkpoint.benchmark.test.ts
// 10 warm-up + 80 measured samples. Dirty measures only the same-tick rerender, not its
// preceding ordinary render. Includes the actual modifier, generator and compositor.
for (const modifierId of ['echo', 'feedback']) {
  it.runIf(process.env.LEDRUMS_HEALTH_BENCH === '1')(`profiles actual ${modifierId}: 16 voices × 4096 pixels, ordinary and dirty presentations`, () => {
    const rows: object[] = [];
    for (const mode of ['render', 'ordinary', 'dirty'] as const) {
      const model = runtimeModel([4096]);
      const voices = Array.from({ length: 16 }, (_, i) => runtimeVoice({ id: `v${i + 1}`,
        modifiers: [{ modifierId, params: { delayMs: 32, feedback: 0.5, amount: 0.5, shift: 1 } }],
      }, runtimeAction({ params: { brightness: 0.1 } }), 'solid-colour'));
      const compositor = createDefaultCompositor();
      const dst = new Framebuffer(model.pixelCount);
      const samples: number[] = [];
      for (let tick = 0; tick < 90; tick++) {
        const frame = runtimeFrame(tick * 16);
        if (mode === 'dirty') compositor.renderPresentation(voices, model, frame, dst, tick);
        const start = performance.now();
        if (mode === 'render') compositor.render(voices, model, frame, dst);
        else compositor.renderPresentation(voices, model, frame, dst, tick);
        if (tick >= 10) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      rows.push({ modifierId, mode, medianMs: samples[40]!.toFixed(3), p95Ms: samples[76]!.toFixed(3) });
      expect(dst.rgba.every(Number.isFinite)).toBe(true);
      expect(dst.rgba.some((v) => v > 0)).toBe(true);
    }
    console.table(rows);
  }, 30000);
}
