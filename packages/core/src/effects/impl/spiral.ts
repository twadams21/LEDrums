import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../field';
import { pnum, type EffectGenerator } from '../types';

/**
 * Rotating spiral arms across the kit XY plane: angle + radius drive a sine whose
 * arm count and twist are tunable; brightness peaks on the arms, hue shifts with the band.
 */
export const spiral: EffectGenerator = {
  id: 'spiral',
  name: 'Spiral',
  category: 'texture',
  paramSpec: [
    { key: 'arms', label: 'Arms', type: 'number', default: 3, min: 1, max: 8, step: 1 },
    { key: 'twist', label: 'Twist', type: 'number', default: 12, min: 0, max: 40, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 5, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 280, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const arms = pnum(params, 'arms', 3);
    const twist = pnum(params, 'twist', 12);
    const sp = pnum(params, 'speed', 1);
    const hue = pnum(params, 'hue', 280);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    renderUvField(ctx, fb, 'planar-xy', (u, v, t) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const ang = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy);
      // Spiral wave: arms sweep around, radius adds the twisting offset.
      let s = 0.5 + 0.5 * Math.sin(ang * arms + r * twist - t * sp * 2);
      s = clamp01(Math.pow(s, 1.6)); // tighten the arms into brighter ridges
      const fade = clamp01(1 - r * 1.3); // dim toward the rim
      const c = hsvToRgb(hue + s * 60 + r * 40, sat, bri * s * fade);
      return [c.r, c.g, c.b];
    });
  },
};
