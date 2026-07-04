/**
 * Chromatic offset — chromatic aberration along the strip: the red channel is sampled `amount`
 * px one way and the blue channel `amount` px the other, while green and alpha stay put, so
 * bright edges fringe into red/cyan. amount = 0 is identity. Spatial+colour, edge-clamped;
 * reads a per-frame snapshot so the shifted samples come from the original frame. Pure.
 */
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';
import { clampIndex, makeScratch, rangeLen, snapshotRange, type ScratchState } from './strip';

export const chromatic: ModifierDef<ScratchState> = {
  id: 'chromatic',
  name: 'Chromatic',
  category: 'color',
  paramSpec: [{ key: 'amount', label: 'Offset', type: 'number', default: 2, min: -32, max: 32, step: 1, unit: 'px' }],
  createState: makeScratch,

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const amount = Math.round(pnum(params, 'amount', 2));
    if (amount === 0) return; // identity
    const len = rangeLen(range);
    if (len <= 0) return;
    snapshotRange(fb, range, state.scratch);
    const s = state.scratch;
    const dst = fb.rgba;
    for (let p = 0; p < len; p++) {
      const rIdx = clampIndex(range, p - amount, len) * 4;
      const bIdx = clampIndex(range, p + amount, len) * 4;
      const di = (range.start + p) * 4;
      dst[di] = s[rIdx]!; // red shifted −amount
      dst[di + 2] = s[bIdx + 2]!; // blue shifted +amount (green + alpha unchanged)
    }
  },
};
