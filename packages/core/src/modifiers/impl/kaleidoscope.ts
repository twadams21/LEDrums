/**
 * Kaleidoscope — folds the voice's strip into `segments` mirrored wedges: the first wedge is
 * the source, and each subsequent wedge alternately reflects it, so the range reads as a
 * symmetric, tiled reflection of its opening slice. segments = 1 is identity. Spatial, reads
 * a per-frame snapshot; pure.
 */
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';
import { makeScratch, rangeLen, snapshotRange, type ScratchState } from './strip';

export const kaleidoscope: ModifierDef<ScratchState> = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'spatial',
  paramSpec: [{ key: 'segments', label: 'Segments', type: 'number', default: 2, min: 1, max: 16, step: 1 }],
  createState: makeScratch,

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const segments = Math.max(1, Math.round(pnum(params, 'segments', 2)));
    if (segments <= 1) return; // identity
    const len = rangeLen(range);
    if (len <= 1) return;
    snapshotRange(fb, range, state.scratch);
    const s = state.scratch;
    const dst = fb.rgba;
    const wedge = len / segments;
    for (let p = 0; p < len; p++) {
      const w = Math.floor(p / wedge);
      let local = p - w * wedge;
      if (w % 2 === 1) local = wedge - 1 - local; // reflect odd wedges
      let src = Math.round(local);
      if (src < 0) src = 0;
      else if (src >= len) src = len - 1;
      const gi = (range.start + src) * 4;
      const di = (range.start + p) * 4;
      dst[di] = s[gi]!;
      dst[di + 1] = s[gi + 1]!;
      dst[di + 2] = s[gi + 2]!;
      dst[di + 3] = s[gi + 3]!;
    }
  },
};
