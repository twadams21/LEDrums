import { mulberry32 } from '../../math';
import { hsvToRgb } from '../../color/color';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

export interface PixelAccumState {
  intensity: Float32Array;
  rng: () => number;
  lastSeq: number;
}

const SEED = 0x9e3779b9;

/**
 * Pixel Accumulation: each hit lights a few random pixels to full, then everything
 * decays (design "pixels turning on randomly throughout the drum with each hit").
 * Stateful + seeded so two engines fed the same hits accumulate identically (R13).
 */
export const pixelAccum: EffectGenerator<PixelAccumState> = {
  id: 'pixel-accum',
  name: 'Pixel Accumulation',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'addPerHit', label: 'Pixels / Hit', type: 'number', default: 6, min: 1, max: 64, step: 1 },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 1200, min: 50, max: 8000, unit: 'ms' },
  ],
  createState(model: PixelModel): PixelAccumState {
    return { intensity: new Float32Array(model.pixelCount), rng: mulberry32(SEED), lastSeq: 0 };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const addPerHit = Math.max(1, Math.round(pnum(params, 'addPerHit', 6)));
    const decay = Math.max(1, pnum(params, 'decayMs', 1200));
    const n = state.intensity.length;

    // Decay existing energy.
    const factor = Math.exp(-ctx.dt / decay);
    for (let i = 0; i < n; i++) state.intensity[i]! *= factor;

    // Light random pixels for each newly-arrived trigger (process once via seq).
    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      for (let k = 0; k < addPerHit; k++) {
        const idx = Math.floor(state.rng() * n) % n;
        state.intensity[idx] = Math.max(state.intensity[idx]!, trig.velocity);
      }
    }

    for (let i = 0; i < n; i++) {
      const v = state.intensity[i]!;
      if (v < 0.004) continue;
      const rgb = hsvToRgb(hue, sat, bri * v);
      fb.max(i, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
