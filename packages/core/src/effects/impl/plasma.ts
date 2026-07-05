import { renderUvField } from '../../canvas/sampler';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Classic multi-sine plasma wrapped around each drum. Several sine layers at
 * different frequencies/phases sum into a smoothly churning field; the hue
 * shifts with the field value so colour and brightness move together.
 */
export const plasma: EffectGenerator = {
  id: 'plasma',
  name: 'Plasma',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 5, step: 0.01 },
    { key: 'scale', label: 'Scale', type: 'number', default: 4, min: 1, max: 16, step: 0.5 },
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 120, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const sp = pnum(params, 'speed', 1);
    const sc = pnum(params, 'scale', 4);
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 1);
    const spread = pnum(params, 'hueSpread', 120);

    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const a = u * Math.PI * 2; // angle is cyclic; use sin/cos so the seam is continuous
      let n =
        Math.sin(a * sc + t * sp) +
        Math.sin(v * sc - t * sp * 0.7) +
        Math.sin((Math.cos(a) + v) * sc * 0.5 + t * sp * 1.3) +
        Math.sin(Math.hypot(Math.sin(a) * sc, v * sc - t * sp * 0.4));
      n = (n / 4) * 0.5 + 0.5; // → [0,1]
      const c = hsvToRgb(hue + n * spread, sat, bri * (0.25 + 0.75 * n));
      return [c.r, c.g, c.b];
    });
  },
};
