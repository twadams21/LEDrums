/**
 * Grain / Noise — animated film-grain texture. Each frame modulates every pixel's
 * brightness by a fresh field of SEEDED value noise, so the output shimmers with a
 * moving grain. Monochrome (the same factor across R/G/B) so it dims luma without
 * shifting hue.
 *
 * Per frame, over the range, with a per-frame noise field n[i] ∈ [0,1):
 *   out[i] = src[i] · (1 − amount + amount·n[i])
 *
 * `amount` = 0 is identity; `amount` = 1 multiplies straight by the noise. The field is
 * re-derived each frame from a fixed base seed mixed with a per-voice frame counter
 * (`Prng` / `deriveSeed`, never `Math.random`), so it animates yet replays identically.
 * State is just that frame counter; it resets with the voice.
 */
import { Prng, deriveSeed } from '../../voice/prng';
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Fixed base seed → the animated noise sequence is identical every run. */
const GRAIN_SEED = 0x4752414e; // 'GRAN'

interface GrainState {
  frame: number;
}

export const grain: ModifierDef<GrainState> = {
  id: 'grain',
  name: 'Grain',
  category: 'texture',
  paramSpec: [
    { key: 'amount', label: 'Amount', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
  ],

  createState(): GrainState {
    return { frame: 0 };
  },

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const amount = Math.min(1, Math.max(0, pnum(params, 'amount', 0.3)));
    // A fresh noise field per frame: reseed a PRNG from the base seed + frame counter, then
    // draw one value per pixel. Advancing the counter is what makes the grain animate.
    const rng = new Prng(deriveSeed(GRAIN_SEED, state.frame));
    state.frame++;
    if (amount <= 0) return; // identity — but still advance the frame so timing is stable
    const out = fb.rgba;
    for (let i = range.start; i < range.end; i++) {
      const g = 1 - amount + amount * rng.next();
      const j = i * 4;
      out[j] = out[j]! * g;
      out[j + 1] = out[j + 1]! * g;
      out[j + 2] = out[j + 2]! * g;
      // alpha (coverage) is left intact — grain modulates emitted light, not presence.
    }
  },
};
