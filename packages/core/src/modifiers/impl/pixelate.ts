/**
 * Pixelate / Quantize — spatial block quantization along the strip. Partitions the voice's
 * pixel range into contiguous blocks of `size` pixels and flattens each block to its channel
 * average, so fine detail reads as chunky low-res cells (mosaic / retro-LED look).
 *
 * Per block `[b, min(b+size, end))`, per channel: out = mean(channel over the block), written
 * to every pixel in the block. Blocks are anchored at `range.start`, so the partition is
 * stable regardless of the voice's absolute position. `size = 1` is identity.
 *
 * Stateless + pure: no per-voice state, no time, no randomness — a fixed spatial reduction of
 * the current frame. Averaged in place, block by block (a block is read fully before it is
 * overwritten), so no scratch buffer is needed.
 */
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const pixelate: ModifierDef = {
  id: 'pixelate',
  name: 'Pixelate',
  category: 'spatial',
  paramSpec: [
    { key: 'size', label: 'Block', type: 'number', default: 4, min: 1, max: 64, step: 1, unit: 'px' },
  ],

  apply(_ctx, params, fb, range: PixelRange): void {
    const size = Math.max(1, Math.round(pnum(params, 'size', 4)));
    const src = fb.rgba;
    for (let start = range.start; start < range.end; start += size) {
      const end = Math.min(start + size, range.end);
      const n = end - start;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = start; i < end; i++) sum += src[i * 4 + c]!;
        const avg = sum / n;
        for (let i = start; i < end; i++) src[i * 4 + c] = avg;
      }
    }
  },
};
