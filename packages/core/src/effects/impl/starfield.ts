import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

interface Star {
  /** Pixel id this star lives on. */
  id: number;
  /** Phase offset (radians) so stars twinkle out of sync. */
  phase: number;
  /** Per-star rate multiplier so they don't pulse in lockstep. */
  rateScale: number;
}

export interface StarfieldState {
  stars: Star[];
  /** Pixel count the stars were seeded for (re-seed if the model changes). */
  seededFor: number;
  /** Star count the stars were seeded for (re-seed if `count` changes). */
  seededCount: number;
  /** The per-voice seed the layout was built from (item C) — reused when count changes. */
  seed: number;
}

const SEED = 0x57a4f1e1;

function seedStars(model: PixelModel, count: number, seed: number): Star[] {
  const rng = mulberry32(seed);
  const n = Math.max(0, model.pixelCount);
  const stars: Star[] = [];
  for (let k = 0; k < count; k++) {
    const id = n > 0 ? Math.floor(rng() * n) % n : 0;
    const phase = rng() * Math.PI * 2;
    const rateScale = 0.6 + rng() * 0.8; // 0.6 .. 1.4
    stars.push({ id, phase, rateScale });
  }
  return stars;
}

/**
 * Starfield: a fixed, seeded set of "stars" scattered across pixels, each twinkling
 * with its own sine phase. Near-white with a faint hue tint, like a deep-space wash.
 * Stateful + seeded so the same star layout replays identically (R13).
 *
 * Voice timebase (S26): the twinkle phase reads `ctx.timeMs`, which the bridge makes
 * hit-relative, so the twinkle restarts from its seeded phase on each hit. Per-voice
 * `genState` (the seeded star layout) is reset on (re)spawn, so a retrigger replays the
 * identical layout from t=0 — no state leaks across voices.
 */
export const starfield: EffectGenerator<StarfieldState> = {
  id: 'starfield',
  name: 'Starfield',
  category: 'particle',
  timebase: 'voice',
  paramSpec: [
    { key: 'count', label: 'Stars', type: 'number', default: 48, min: 1, max: 512, step: 1 },
    { key: 'rate', label: 'Twinkle Rate', type: 'number', default: 2.5, min: 0, max: 20, step: 0.1, unit: 'Hz' },
    { key: 'hue', label: 'Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel, seed?: number): StarfieldState {
    const count = 48;
    const s = seed ?? SEED;
    return { stars: seedStars(model, count, s), seededFor: model.pixelCount, seededCount: count, seed: s };
  },
  render(ctx, params, fb, state) {
    const count = Math.max(1, Math.round(pnum(params, 'count', 48)));
    const rate = pnum(params, 'rate', 2.5);
    const hue = pnum(params, 'hue', 210);
    const sat = pnum(params, 'saturation', 0.15);
    const bri = pnum(params, 'brightness', 1);

    // Re-seed if the model size or requested star count changed.
    if (state.seededFor !== ctx.model.pixelCount || state.seededCount !== count) {
      state.stars = seedStars(ctx.model, count, state.seed ?? SEED);
      state.seededFor = ctx.model.pixelCount;
      state.seededCount = count;
    }

    const t = ctx.timeMs / 1000;
    for (const star of state.stars) {
      if (star.id < 0 || star.id >= ctx.model.pixelCount) continue;
      // Twinkle 0..1 from a sine; bias upward so stars never fully vanish for long.
      const twinkle = 0.5 + 0.5 * Math.sin(t * rate * star.rateScale * Math.PI * 2 + star.phase);
      const v = clamp01(bri * twinkle);
      if (v < 0.004) continue;
      // Near-white with a faint hue tint by default (low saturation); now controllable.
      const rgb = hsvToRgb(hue, sat, v);
      fb.max(star.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
