/**
 * Slide / Offset — shifts the voice's strip along its pixel range by `offset` pixels.
 * Fractional offsets sample with linear interpolation between neighbours; the strip edges
 * either `wrap` (toroidal scroll) or `clamp` (smear the edge pixel). offset = 0 is identity.
 *
 * Spatial, stateless-in-time: reads a per-frame snapshot of the range so the shift never
 * reads its own partial output. Pure — output depends only on (offset, edge, fb).
 */
import { pnum, pstr } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';
import { clampIndex, makeScratch, rangeLen, snapshotRange, wrapIndex, type ScratchState } from './strip';

export const slide: ModifierDef<ScratchState> = {
  id: 'slide',
  name: 'Slide',
  category: 'spatial',
  paramSpec: [
    { key: 'offset', label: 'Offset', type: 'number', default: 0, min: -256, max: 256, step: 1, unit: 'px' },
    { key: 'edge', label: 'Edge', type: 'enum', default: 'wrap', options: ['wrap', 'clamp'] },
  ],
  createState: makeScratch,

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const offset = pnum(params, 'offset', 0);
    if (offset === 0) return; // identity
    const len = rangeLen(range);
    if (len <= 0) return;
    const wrap = pstr(params, 'edge', 'wrap') !== 'clamp';
    snapshotRange(fb, range, state.scratch);
    const s = state.scratch;
    const dst = fb.rgba;
    for (let p = 0; p < len; p++) {
      // Content moves +offset along the strip → sample the source at p − offset.
      const srcF = p - offset;
      const i0 = Math.floor(srcF);
      const frac = srcF - i0;
      const gi0 = (wrap ? wrapIndex(range, i0, len) : clampIndex(range, i0, len)) * 4;
      const gi1 = (wrap ? wrapIndex(range, i0 + 1, len) : clampIndex(range, i0 + 1, len)) * 4;
      const di = (range.start + p) * 4;
      for (let c = 0; c < 4; c++) {
        const a = s[gi0 + c]!;
        dst[di + c] = a + (s[gi1 + c]! - a) * frac;
      }
    }
  },
};
