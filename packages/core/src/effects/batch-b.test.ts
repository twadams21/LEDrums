import { describe, expect, it } from 'vitest';
import { model, transport, ctx, render, litCount } from '../test-support/effect-harness';
import { type EffectGenerator } from './types';
import { perlinClouds } from './impl/perlin-clouds';
import { lavaLamp } from './impl/lava-lamp';
import { interference } from './impl/interference';
import { caustics } from './impl/caustics';
import { spiral } from './impl/spiral';
import { gridGlow } from './impl/grid-glow';

const BATCH_B: EffectGenerator[] = [perlinClouds, lavaLamp, interference, caustics, spiral, gridGlow];

describe('batch-b texture effects', () => {
  it('all declare the texture category', () => {
    for (const e of BATCH_B) expect(e.category, e.id).toBe('texture');
  });

  it('each lights at least one pixel over a few sampled frames', () => {
    const m = model(2, 4);
    for (const e of BATCH_B) {
      // Sample several phases — a static frame could land on a dark trough.
      let maxLit = 0;
      for (const timeMs of [0, 130, 410, 777, 1234]) {
        const fb = render(e, m, ctx(m, { timeMs, transport: transport(timeMs / 500, timeMs) }));
        maxLit = Math.max(maxLit, litCount(fb));
      }
      expect(maxLit, e.id).toBeGreaterThan(0);
    }
  });

  it('emit only finite channel values in [0,1] across phases', () => {
    const m = model(2, 4);
    for (const e of BATCH_B) {
      for (const timeMs of [0, 250, 999, 3000]) {
        const fb = render(e, m, ctx(m, { timeMs, transport: transport(timeMs / 500, timeMs) }));
        for (let i = 0; i < fb.rgba.length; i++) {
          const val = fb.rgba[i]!;
          expect(Number.isFinite(val), `${e.id} channel ${i} @ ${timeMs}ms = ${val}`).toBe(true);
          expect(val >= 0 && val <= 1, `${e.id} channel ${i} @ ${timeMs}ms = ${val}`).toBe(true);
        }
      }
    }
  });

  it('respond to brightness=0 by going dark', () => {
    const m = model(1, 4);
    for (const e of BATCH_B) {
      // Every batch-b effect exposes a brightness param.
      const fb = render(e, m, ctx(m, { timeMs: 300 }), { brightness: 0 });
      expect(litCount(fb), e.id).toBe(0);
    }
  });
});
