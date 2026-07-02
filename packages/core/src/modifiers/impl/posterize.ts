/**
 * Posterize / Threshold — a pointwise colour crush over the voice's range. `posterize` snaps
 * each RGB channel to one of `levels` evenly-spaced steps (banding / cel-shade look);
 * `threshold` hard-binarises each channel about `threshold` (1-bit stencil). Alpha (coverage)
 * is left untouched so the blend weight is preserved. Pure, per-pixel, no state.
 */
import { pnum, pstr } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const posterize: ModifierDef = {
  id: 'posterize',
  name: 'Posterize',
  category: 'color',
  paramSpec: [
    { key: 'mode', label: 'Mode', type: 'enum', default: 'posterize', options: ['posterize', 'threshold'] },
    { key: 'levels', label: 'Levels', type: 'number', default: 4, min: 2, max: 32, step: 1 },
    { key: 'threshold', label: 'Threshold', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
  ],

  apply(_ctx, params, fb, range: PixelRange): void {
    const dst = fb.rgba;
    if (pstr(params, 'mode', 'posterize') === 'threshold') {
      const t = pnum(params, 'threshold', 0.5);
      for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        dst[j] = dst[j]! >= t ? 1 : 0;
        dst[j + 1] = dst[j + 1]! >= t ? 1 : 0;
        dst[j + 2] = dst[j + 2]! >= t ? 1 : 0;
      }
      return;
    }
    // Posterize: quantise to `levels` steps. step = levels − 1 so 0 and 1 stay exact.
    const step = Math.max(1, Math.round(pnum(params, 'levels', 4)) - 1);
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      dst[j] = Math.round(dst[j]! * step) / step;
      dst[j + 1] = Math.round(dst[j + 1]! * step) / step;
      dst[j + 2] = Math.round(dst[j + 2]! * step) / step;
    }
  },
};
