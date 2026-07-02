/**
 * Trail / Decay — the temporal-smear modifier (motion trails, phosphor decay). Keeps a
 * per-voice accumulator of the previous output and blends the fresh frame over a decaying
 * copy of it, so moving content leaves a fading tail.
 *
 * Per frame, over the voice's pixel range, per channel:
 *   decayed = acc · k,   k = exp(-dt / decayMs)   (dt, decayMs in ms; decayMs ≤ 0 ⇒ k = 0)
 *   out     = mode === 'max' ? max(current, decayed) : min(1, current + decayed)
 *   acc = out;  fb = out
 *
 * `add` builds brightness where the tail overlaps the head (glowy smear); `max` holds the
 * brightest of head/tail (clean comet with no additive bloom). Pure + deterministic: the
 * only state is the accumulator, which is per-voice and resets with the voice — so a
 * retrigger (new voice) starts from a clean tail (group-G per-voice-state rule).
 *
 * Tracer note (S30–S32 copy this shape): a modifier is `{ id, name, category, paramSpec,
 * createState?, apply }`; temporal state lives in `createState` (sized to the model),
 * `apply` reads `ctx.dt` for integration and never re-derives time.
 */
import { Framebuffer } from '../../engine/framebuffer';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, pstr } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Per-voice accumulator: a full-frame float RGBA buffer (only the voice's range is touched).
    At kit scale (~548 px) this is trivially small; sizing to the model keeps `apply` index
    math identical to `fb` (no range rebasing). */
interface TrailState {
  acc: Framebuffer;
}

export const trail: ModifierDef<TrailState> = {
  id: 'trail',
  name: 'Trail',
  category: 'temporal',
  paramSpec: [
    { key: 'decayMs', label: 'Decay', type: 'number', default: 250, min: 0, max: 4000, step: 10, unit: 'ms' },
    { key: 'mode', label: 'Mode', type: 'enum', default: 'add', options: ['add', 'max'] },
  ],

  createState(model: PixelModel): TrailState {
    return { acc: new Framebuffer(model.pixelCount) };
  },

  apply(ctx, params, fb, range: PixelRange, state): void {
    const decayMs = pnum(params, 'decayMs', 250);
    const useMax = pstr(params, 'mode', 'add') === 'max';
    // Exponential decay of the retained tail over the frame delta. decayMs ≤ 0 → no tail.
    const k = decayMs > 0 ? Math.exp(-ctx.dt / decayMs) : 0;
    const src = fb.rgba;
    const acc = state.acc.rgba;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      for (let c = 0; c < 4; c++) {
        const cur = src[j + c]!;
        const decayed = acc[j + c]! * k;
        const out = useMax ? Math.max(cur, decayed) : Math.min(1, cur + decayed);
        acc[j + c] = out;
        src[j + c] = out;
      }
    }
  },
};
