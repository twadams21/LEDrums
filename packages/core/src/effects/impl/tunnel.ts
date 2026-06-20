import { wrap } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../field';

/**
 * A polar "tunnel" zoom across the kit's x/y plane: hue spins with the angle
 * while brightness pulses with 1/r, giving the illusion of receding rings
 * rushing toward (or away from) the centre.
 */
export const tunnel: EffectGenerator = {
  id: 'tunnel',
  name: 'Tunnel',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'rings', label: 'Rings', type: 'number', default: 8, min: 1, max: 30, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.5, min: -6, max: 6, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const rings = pnum(params, 'rings', 8);
    const sp = pnum(params, 'speed', 1.5);
    const hue = pnum(params, 'hue', 0);

    renderUvField(ctx, fb, 'planar-xy', (u, v, t) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const ang = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy);
      const h = wrap(hue + (ang / Math.PI) * 180 + t * sp * 30, 360);
      // Inverse-radius gives the "depth" stripes; clamp to keep it finite at centre.
      const depth = (1 / (r + 0.05)) * rings - t * sp;
      const pulse = 0.5 + 0.5 * Math.sin(depth);
      // Fade slightly toward the bright hot centre, dim at the rim.
      const val = bri * pulse * (0.4 + 0.6 * Math.min(1, r * 2.2));
      const c = hsvToRgb(h, 1, val);
      return [c.r, c.g, c.b];
    });
  },
};
