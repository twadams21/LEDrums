import { clamp01, wrap } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Hue Rotate Kit: a full, saturated wash whose hue rotates continuously over time
 * and also shifts with world height (Y), giving the kit a sense of vertical depth
 * as the colour band slides up and rotates.
 */
export const hueRotateKit: EffectGenerator = {
  id: 'hue-rotate-kit',
  name: 'Hue Rotate Kit',
  category: 'base',
  paramSpec: [
    { key: 'baseHue', label: 'Base Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.3, min: 0, max: 4, step: 0.01 },
    { key: 'ky', label: 'Vertical Spread', type: 'number', default: 0.15, min: 0, max: 2, step: 0.01, unit: '°/mm' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const baseHue = pnum(params, 'baseHue', 0);
    const speed = pnum(params, 'speed', 0.3);
    const ky = pnum(params, 'ky', 0.15);
    const bri = clamp01(pnum(params, 'brightness', 0.8));
    const sat = pnum(params, 'saturation', 1);
    const t = ctx.timeMs * 0.001;

    for (const p of ctx.model.pixels) {
      const hue = wrap(baseHue + t * speed * 60 + p.world.y * ky, 360);
      const rgb = hsvToRgb(hue, sat, bri);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
