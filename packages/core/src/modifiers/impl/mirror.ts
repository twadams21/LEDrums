/**
 * Mirror — reflects the voice's pixel range so it reads symmetrically. The `axis` ENUM
 * (S18 Select control) chooses which half is the source of the reflection:
 *   - `low`  — the low-index half is the source, mirrored onto the high half (symmetric).
 *   - `high` — the high-index half is the source, mirrored onto the low half (symmetric).
 *   - `flip` — no source half; the whole range is reversed end-to-end.
 *
 * A local index `p` (0..N−1 within the range) reflects to `N−1−p`. `low`/`high` only write
 * the destination half while reading the source half (disjoint but for the odd-length middle
 * pixel, which maps to itself), and `flip` swaps mirror pairs — so every variant is an
 * in-place permutation with no scratch buffer and no aliasing.
 *
 * Stateless + pure: a fixed spatial rearrangement of the current frame; no time, no state,
 * no randomness. `size = 1` ranges and empty ranges are no-ops.
 */
import { pstr } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Copy all 4 channels of pixel `from` into pixel `to`. */
function copyPixel(rgba: Float32Array, to: number, from: number): void {
  const t = to * 4;
  const f = from * 4;
  rgba[t] = rgba[f]!;
  rgba[t + 1] = rgba[f + 1]!;
  rgba[t + 2] = rgba[f + 2]!;
  rgba[t + 3] = rgba[f + 3]!;
}

/** Swap all 4 channels of pixels `a` and `b`. */
function swapPixel(rgba: Float32Array, a: number, b: number): void {
  const ai = a * 4;
  const bi = b * 4;
  for (let c = 0; c < 4; c++) {
    const tmp = rgba[ai + c]!;
    rgba[ai + c] = rgba[bi + c]!;
    rgba[bi + c] = tmp;
  }
}

export const mirror: ModifierDef = {
  id: 'mirror',
  name: 'Mirror',
  category: 'spatial',
  paramSpec: [
    { key: 'axis', label: 'Axis', type: 'enum', default: 'low', options: ['low', 'high', 'flip'] },
  ],

  apply(_ctx, params, fb, range: PixelRange): void {
    const axis = pstr(params, 'axis', 'low');
    const start = range.start;
    const n = range.end - start;
    if (n <= 1) return;
    const rgba = fb.rgba;
    if (axis === 'flip') {
      for (let p = 0; p < n >> 1; p++) swapPixel(rgba, start + p, start + n - 1 - p);
      return;
    }
    if (axis === 'high') {
      // Source = high half; write the low half from its mirror partner.
      for (let p = 0; p < n - 1 - p; p++) copyPixel(rgba, start + p, start + n - 1 - p);
      return;
    }
    // 'low' (default): source = low half; write the high half from its mirror partner.
    for (let p = n - 1; p > n - 1 - p; p--) copyPixel(rgba, start + p, start + n - 1 - p);
  },
};
