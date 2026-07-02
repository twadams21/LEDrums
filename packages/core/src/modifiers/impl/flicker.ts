/**
 * Flicker / Glitch — seeded per-pixel brightness noise plus random dropout. Each frame a
 * deterministic RNG (seeded from `seed` × the voice-local frame time) dims each pixel by up to
 * `intensity` and blacks it out with probability `dropProb`, for a strobing, broken-signal
 * texture. intensity = 0 && dropProb = 0 is identity.
 *
 * Purity is preserved WITHOUT `Math.random`: the RNG seed is a pure function of (seed, timeMs),
 * so the same voice-local frame always yields the same flicker (group-G determinism rule).
 * Texture category; no persistent state.
 */
import { mulberry32 } from '../../math';
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const flicker: ModifierDef = {
  id: 'flicker',
  name: 'Flicker',
  category: 'texture',
  paramSpec: [
    { key: 'intensity', label: 'Intensity', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: 'dropProb', label: 'Dropout', type: 'number', default: 0.05, min: 0, max: 1, step: 0.01 },
    { key: 'seed', label: 'Seed', type: 'number', default: 1, min: 0, max: 9999, step: 1 },
  ],

  apply(ctx, params, fb, range: PixelRange): void {
    const intensity = pnum(params, 'intensity', 0.5);
    const dropProb = pnum(params, 'dropProb', 0.05);
    if (intensity <= 0 && dropProb <= 0) return; // identity
    const seed = Math.floor(pnum(params, 'seed', 1));
    // Per-frame seed from the voice-local clock — deterministic across runs, distinct per tick.
    const frameKey = Math.floor(ctx.timeMs);
    const rng = mulberry32((seed ^ Math.imul(frameKey + 1, 0x9e3779b1)) >>> 0);
    const dst = fb.rgba;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      const dim = rng();
      const factor = rng() < dropProb ? 0 : 1 - intensity * dim;
      dst[j] = dst[j]! * factor;
      dst[j + 1] = dst[j + 1]! * factor;
      dst[j + 2] = dst[j + 2]! * factor;
    }
  },
};
