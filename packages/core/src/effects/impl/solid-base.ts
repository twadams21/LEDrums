import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Always-on base layer: a slow 3D swirl over the kit (design "always on content that
 * swirls and moves"). Value rises with brightness and is never zero when brightness>0.
 */
export const solidBase: EffectGenerator = {
  id: 'solid-base',
  name: 'Solid Base (Swirl)',
  category: 'base',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.3, min: 0, max: 4, step: 0.01 },
    { key: 'noise', label: 'Noise', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 210);
    const sat = pnum(params, 'saturation', 0.7);
    const bri = pnum(params, 'brightness', 0.4);
    const speed = pnum(params, 'speed', 0.3);
    const noise = pnum(params, 'noise', 0.4);
    const t = ctx.timeMs * 0.001 * speed;

    for (const p of ctx.model.pixels) {
      const { x, y, z } = p.world;
      let n = 0.5 + 0.5 * Math.sin(x * 0.006 + z * 0.004 + t * 1.7);
      n = n * 0.6 + (0.5 + 0.5 * Math.sin(y * 0.008 - t * 1.1)) * 0.4;
      const hi = 0.5 + 0.5 * Math.sin((x + y) * 0.02 + t * 4.0);
      n = clamp01(n * (1 - noise) + hi * noise);
      const v = bri * (0.4 + 0.6 * n);
      const rgb = hsvToRgb(hue + n * 40, sat, v);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
