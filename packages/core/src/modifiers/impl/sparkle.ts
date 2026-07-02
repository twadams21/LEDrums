/**
 * Sparkle — random decaying glints. Each frame a few pixels light up white and then fade,
 * scattering shimmering points over the voice's output. The randomness is a SEEDED
 * per-voice PRNG (never `Math.random`), so the twinkle pattern is byte-for-byte
 * reproducible on every replay — the group-G determinism contract.
 *
 * Per frame, over the range:
 *   glint[i] = glint[i]·k,  k = exp(-dt / decayMs)   (existing glints fade)
 *   if rng() < p  →  glint[i] = 1                     (p = density·dt/1000, a new glint)
 *   out[i] = max(src[i], glint[i])                    (white point, visible over dark)
 *
 * State is the seeded PRNG cursor plus a per-pixel glint buffer; both reset with the voice,
 * so a retrigger restarts the same deterministic sparkle from a clean field.
 */
import { Prng } from '../../voice/prng';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Fixed seed → the glint sequence is identical every run (determinism, not novelty). */
const SPARKLE_SEED = 0x53504b4c; // 'SPKL'

interface SparkleState {
  rng: Prng;
  glint: Float32Array;
}

export const sparkle: ModifierDef<SparkleState> = {
  id: 'sparkle',
  name: 'Sparkle',
  category: 'texture',
  paramSpec: [
    { key: 'density', label: 'Density', type: 'number', default: 6, min: 0, max: 60, step: 1, unit: '/s' },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 300, min: 0, max: 4000, step: 10, unit: 'ms' },
  ],

  createState(model: PixelModel): SparkleState {
    return { rng: new Prng(SPARKLE_SEED), glint: new Float32Array(model.pixelCount) };
  },

  apply(ctx, params, fb, range: PixelRange, state): void {
    const density = pnum(params, 'density', 6);
    const decayMs = pnum(params, 'decayMs', 300);
    const k = decayMs > 0 ? Math.exp(-ctx.dt / decayMs) : 0;
    // Per-pixel spawn probability this frame: density (glints/sec) over the frame delta.
    const p = Math.min(1, Math.max(0, (density * ctx.dt) / 1000));
    const out = fb.rgba;
    const glint = state.glint;
    for (let i = range.start; i < range.end; i++) {
      let g = glint[i]! * k;
      if (state.rng.next() < p) g = 1;
      glint[i] = g;
      if (g <= 0) continue;
      const j = i * 4;
      out[j] = Math.max(out[j]!, g);
      out[j + 1] = Math.max(out[j + 1]!, g);
      out[j + 2] = Math.max(out[j + 2]!, g);
      out[j + 3] = Math.max(out[j + 3]!, g);
    }
  },
};
