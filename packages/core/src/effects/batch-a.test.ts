import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { plasma } from './impl/plasma';
import { fire } from './impl/fire';
import { ripplePond } from './impl/ripple-pond';
import { rainbowFlow } from './impl/rainbow-flow';
import { tunnel } from './impl/tunnel';
import { checkerPulse } from './impl/checker-pulse';

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

/** Every channel must be a finite number within [0,1]. */
function allFiniteInRange(fb: Framebuffer): boolean {
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

const effects: ReadonlyArray<{ effect: EffectGenerator; id: string }> = [
  { effect: plasma, id: 'plasma' },
  { effect: fire, id: 'fire' },
  { effect: ripplePond, id: 'ripple-pond' },
  { effect: rainbowFlow, id: 'rainbow-flow' },
  { effect: tunnel, id: 'tunnel' },
  { effect: checkerPulse, id: 'checker-pulse' },
];

describe('batch-a texture effects', () => {
  for (const { effect, id } of effects) {
    describe(id, () => {
      it('declares the texture category and matching id', () => {
        expect(effect.id).toBe(id);
        expect(effect.category).toBe('texture');
      });

      it('lights at least one pixel at a non-trivial time', () => {
        const m = model();
        // Sample a couple of non-zero times so we never accidentally hit a global dark frame.
        const a = litCount(render(effect, m, ctx(m, { timeMs: 1234 })));
        const b = litCount(render(effect, m, ctx(m, { timeMs: 4870 })));
        expect(Math.max(a, b)).toBeGreaterThan(0);
      });

      it('emits only finite channel values in [0,1] across several frames', () => {
        const m = model();
        for (const timeMs of [0, 250, 1234, 4870, 9999]) {
          const fb = render(effect, m, ctx(m, { timeMs }));
          expect(allFiniteInRange(fb)).toBe(true);
        }
      });

      it('stays finite and in range under extreme params', () => {
        const m = model();
        const spec = effect.paramSpec;
        const lo: ResolvedParams = {};
        const hi: ResolvedParams = {};
        for (const s of spec) {
          if (s.type === 'number') {
            lo[s.key] = s.min ?? 0;
            hi[s.key] = s.max ?? 1;
          }
        }
        for (const params of [lo, hi]) {
          for (const timeMs of [0, 2222, 8888]) {
            const fb = render(effect, m, ctx(m, { timeMs }), params);
            expect(allFiniteInRange(fb)).toBe(true);
          }
        }
      });
    });
  }
});
