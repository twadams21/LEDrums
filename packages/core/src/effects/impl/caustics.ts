import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../../canvas/sampler';
import { pnum, type EffectGenerator } from '../types';

/**
 * Water caustics over the kit floor (planar-xz): several scrolling abs(sin) layers
 * are summed and sharpened into bright veins, tinted blue→cyan→white.
 */
export const caustics: EffectGenerator = {
  id: 'caustics',
  name: 'Caustics',
  category: 'texture',
  paramSpec: [
    { key: 'scale', label: 'Scale', type: 'number', default: 8, min: 1, max: 24, step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.8, min: 0, max: 5, step: 0.01 },
    { key: 'hue', label: 'Hue Base', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const scale = pnum(params, 'scale', 8);
    const speed = pnum(params, 'speed', 0.8);
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    renderUvField(ctx, fb, 'planar-xz', (u, v, t) => {
      const x = u * scale;
      const y = v * scale;
      const ph = t * speed;
      // A few criss-crossing wave layers; abs(sin) gives the thin caustic veins.
      const l1 = Math.abs(Math.sin(x + ph) + Math.sin(y - ph * 0.7));
      const l2 = Math.abs(Math.sin(x * 0.7 - y * 1.3 + ph * 1.4));
      const l3 = Math.abs(Math.sin((x + y) * 0.6 + ph * 0.9));
      let n = (l1 + l2 + l3) / 3;
      n = 1 - clamp01(n); // invert so the troughs become bright lines
      n = Math.pow(n, 3); // sharpen into crisp caustic webs
      // `hue` recolours the water (default 200 = blue→cyan); `saturation` scales it (0 ⇒ white veins).
      const c = hsvToRgb(hue - n * 40, sat * clamp01(1 - n * 0.9), bri * clamp01(n * 1.1));
      return [c.r, c.g, c.b];
    });
  },
};
