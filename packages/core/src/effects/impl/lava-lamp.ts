import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../../canvas/sampler';
import { pnum, type EffectGenerator } from '../types';

/**
 * Metaball "lava lamp" in the kit XY plane: 2-4 blobs drift on slow sine paths; the
 * summed inverse-square field is thresholded into a warm red→orange→yellow palette.
 */
export const lavaLamp: EffectGenerator = {
  id: 'lava-lamp',
  name: 'Lava Lamp',
  category: 'texture',
  paramSpec: [
    { key: 'blobs', label: 'Blobs', type: 'number', default: 3, min: 2, max: 4, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.5, min: 0, max: 4, step: 0.01 },
    { key: 'hue', label: 'Hue Base', type: 'number', default: 8, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const blobs = Math.max(2, Math.min(4, Math.round(pnum(params, 'blobs', 3))));
    const speed = pnum(params, 'speed', 0.5);
    const hue = pnum(params, 'hue', 8);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const radius = 0.22;
    const r2 = radius * radius;
    renderUvField(ctx, fb, 'planar-xy', (u, v, t) => {
      let field = 0;
      for (let i = 0; i < blobs; i++) {
        // Each blob orbits on its own slow, phase-offset sine path inside [0.15,0.85].
        const phase = (i / blobs) * Math.PI * 2;
        const cx = 0.5 + 0.35 * Math.sin(t * speed * 0.7 + phase);
        const cy = 0.5 + 0.35 * Math.cos(t * speed * 0.9 + phase * 1.3);
        const dx = u - cx;
        const dy = v - cy;
        const d2 = dx * dx + dy * dy + 1e-4;
        field += r2 / d2;
      }
      const m = clamp01((field - 0.8) * 0.6); // threshold the metaball surface
      if (m <= 0) return [0, 0, 0];
      // Warm palette by default (hue 8): deep red at the edge → orange → yellow-white in
      // hot cores. `hue` recolours the whole lamp; `saturation` scales the palette (0 ⇒ white).
      const c = hsvToRgb(hue + m * 42, sat * clamp01(1 - m * 0.45), bri * clamp01(0.25 + m));
      return [c.r, c.g, c.b];
    });
  },
};
