import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { perlinClouds } from './impl/perlin-clouds';
import { lavaLamp } from './impl/lava-lamp';
import { interference } from './impl/interference';
import { caustics } from './impl/caustics';
import { spiral } from './impl/spiral';
import { gridGlow } from './impl/grid-glow';

function model(drums = 2, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: drumDefs,
    }),
  );
}

function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: opts.timeMs ?? 0,
    dt: opts.dt ?? 16,
    transport: opts.transport ?? transport(0, opts.timeMs ?? 0),
    triggers: opts.triggers ?? [],
  };
}

function render<S>(effect: EffectGenerator<S>, m: PixelModel, c: RenderContext, params?: ResolvedParams, state?: S): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m) : (undefined as S));
  effect.render(c, p, fb, s);
  return fb;
}

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

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
