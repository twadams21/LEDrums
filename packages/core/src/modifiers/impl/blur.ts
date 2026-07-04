/**
 * Blur (1D) — a box blur along the voice's strip: each pixel becomes the uniform average of
 * its neighbours within `radius` (edge-clamped). radius = 0 is identity. Softens hard edges
 * and bleeds colour along the range. Spatial, no temporal state; reads a per-frame snapshot
 * so the running average never folds in already-blurred output. Pure.
 */
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';
import { clampIndex, makeScratch, rangeLen, snapshotRange, type ScratchState } from './strip';

export const blur: ModifierDef<ScratchState> = {
  id: 'blur',
  name: 'Blur',
  category: 'spatial',
  paramSpec: [{ key: 'radius', label: 'Radius', type: 'number', default: 2, min: 0, max: 32, step: 1, unit: 'px' }],
  createState: makeScratch,

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const radius = Math.round(pnum(params, 'radius', 2));
    if (radius <= 0) return; // identity
    const len = rangeLen(range);
    if (len <= 0) return;
    snapshotRange(fb, range, state.scratch);
    const s = state.scratch;
    const dst = fb.rgba;
    for (let p = 0; p < len; p++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const gi = clampIndex(range, p + k, len) * 4;
        r += s[gi]!;
        g += s[gi + 1]!;
        b += s[gi + 2]!;
        a += s[gi + 3]!;
        n++;
      }
      const di = (range.start + p) * 4;
      dst[di] = r / n;
      dst[di + 1] = g / n;
      dst[di + 2] = b / n;
      dst[di + 3] = a / n;
    }
  },
};
