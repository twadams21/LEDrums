/**
 * Bloom / Glow — the spatial-spread modifier. Bleeds each pixel's light into its
 * neighbours along the strip, then adds that halo back over the original, so bright
 * regions gain a soft glow and isolated points feather outward.
 *
 * Over the voice's pixel range, per channel:
 *   glow[i] = Σ_{d=-r..r} src[i+d]·w(d) / Σ w(d)   (triangular falloff, clamped to range)
 *   out[i]  = min(1, src[i] + glow[i]·intensity)
 *
 * Spatial, not temporal: `glow` reads a snapshot of the source (the per-voice scratch),
 * never the partially-written output, so the spread is order-independent and pure. The
 * only state is that scratch buffer (sized to the model, reused each frame — no hot-path
 * alloc); it holds no history, so retrigger is a clean slate.
 */
import { Framebuffer } from '../../engine/framebuffer';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Per-voice scratch: a full-frame snapshot of the source taken before the range is
    rewritten, so the neighbour read never sees already-bloomed pixels. */
interface BloomState {
  src: Framebuffer;
}

export const bloom: ModifierDef<BloomState> = {
  id: 'bloom',
  name: 'Bloom',
  category: 'spatial',
  paramSpec: [
    { key: 'radius', label: 'Radius', type: 'number', default: 3, min: 0, max: 32, step: 1, unit: 'px' },
    { key: 'intensity', label: 'Intensity', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
  ],

  createState(model: PixelModel): BloomState {
    return { src: new Framebuffer(model.pixelCount) };
  },

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const radius = Math.max(0, Math.round(pnum(params, 'radius', 3)));
    const intensity = pnum(params, 'intensity', 0.6);
    const out = fb.rgba;
    const src = state.src.rgba;
    // Snapshot the source range so the spread reads clean, unbloomed neighbours.
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      src[j] = out[j]!;
      src[j + 1] = out[j + 1]!;
      src[j + 2] = out[j + 2]!;
      src[j + 3] = out[j + 3]!;
    }
    for (let i = range.start; i < range.end; i++) {
      let g0 = 0, g1 = 0, g2 = 0, g3 = 0, wsum = 0;
      const lo = Math.max(range.start, i - radius);
      const hi = Math.min(range.end - 1, i + radius);
      for (let k = lo; k <= hi; k++) {
        // Triangular weight: 1 at the centre, tapering to 0 just past ±radius.
        const w = 1 - Math.abs(k - i) / (radius + 1);
        const kj = k * 4;
        g0 += src[kj]! * w;
        g1 += src[kj + 1]! * w;
        g2 += src[kj + 2]! * w;
        g3 += src[kj + 3]! * w;
        wsum += w;
      }
      const inv = wsum > 0 ? intensity / wsum : 0;
      const j = i * 4;
      out[j] = Math.min(1, src[j]! + g0 * inv);
      out[j + 1] = Math.min(1, src[j + 1]! + g1 * inv);
      out[j + 2] = Math.min(1, src[j + 2]! + g2 * inv);
      out[j + 3] = Math.min(1, src[j + 3]! + g3 * inv);
    }
  },
};
