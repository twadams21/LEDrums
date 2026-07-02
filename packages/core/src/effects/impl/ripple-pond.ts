import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../field';

/**
 * Concentric ripples spreading from a slowly drifting centre, projected across
 * the kit's x/z footprint (a pond seen from above). Brightness oscillates with
 * distance to form rings; hue drifts outward from the centre.
 */
export const ripplePond: EffectGenerator = {
  id: 'ripple-pond',
  name: 'Ripple Pond',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'freq', label: 'Frequency', type: 'number', default: 24, min: 2, max: 60, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 2, min: 0, max: 8, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 190, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 80, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const freq = pnum(params, 'freq', 24);
    const sp = pnum(params, 'speed', 2);
    const hue = pnum(params, 'hue', 190);
    const sat = pnum(params, 'saturation', 1);
    const spread = pnum(params, 'hueSpread', 80);

    renderUvField(ctx, fb, 'planar-xz', (u, v, t) => {
      // Centre drifts on a slow Lissajous path within the plane.
      const cx = 0.5 + 0.3 * Math.sin(t * 0.31);
      const cy = 0.5 + 0.3 * Math.cos(t * 0.23);
      const d = Math.hypot(u - cx, v - cy);
      const b = 0.5 + 0.5 * Math.sin(d * freq - t * sp);
      // Rings sharpen with a slight power curve; fall off gently with distance.
      const ring = Math.pow(b, 1.5) * (1 - 0.35 * d);
      const c = hsvToRgb(hue + d * spread, sat * 0.95, bri * Math.max(0, ring));
      return [c.r, c.g, c.b];
    });
  },
};
