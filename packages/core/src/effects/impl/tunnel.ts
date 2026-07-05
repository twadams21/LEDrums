import { wrap } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../../canvas/sampler';

/**
 * A polar "tunnel" zoom across the kit's x/y plane: hue spins with the angle
 * while brightness pulses with 1/r, giving the illusion of receding rings
 * rushing toward (or away from) the centre.
 *
 * Multi-colour: the angle sweeps a full hue wheel around the ring, so a single
 * picker is wrong. `hueOffset` rotates the wheel and `hueRange` narrows it (360 =
 * full rainbow, 0 = one colour); `saturation` desaturates (0 ⇒ white).
 */
export const tunnel: EffectGenerator = {
  id: 'tunnel',
  name: 'Tunnel',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'rings', label: 'Rings', type: 'number', default: 8, min: 1, max: 30, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.5, min: -6, max: 6, step: 0.01 },
    { key: 'hueOffset', label: 'Hue Offset', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'hueRange', label: 'Hue Range', type: 'number', default: 360, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const sat = pnum(params, 'saturation', 1);
    const rings = pnum(params, 'rings', 8);
    const sp = pnum(params, 'speed', 1.5);
    const hueOffset = pnum(params, 'hueOffset', 0);
    const hueRange = pnum(params, 'hueRange', 360);

    renderUvField(ctx, fb, 'planar-xy', (u, v, t) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const ang = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy);
      const h = wrap(hueOffset + (ang / Math.PI) * 180 * (hueRange / 360) + t * sp * 30, 360);
      // Inverse-radius gives the "depth" stripes; clamp to keep it finite at centre.
      const depth = (1 / (r + 0.05)) * rings - t * sp;
      const pulse = 0.5 + 0.5 * Math.sin(depth);
      // Fade slightly toward the bright hot centre, dim at the rim.
      const val = bri * pulse * (0.4 + 0.6 * Math.min(1, r * 2.2));
      const c = hsvToRgb(h, sat, val);
      return [c.r, c.g, c.b];
    });
  },
};
