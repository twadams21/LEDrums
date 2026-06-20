import { clamp01, lerp } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

const WARM_HUE = 30; // amber
const COOL_HUE = 210; // blue

/**
 * Temperature Sweep: a colour-temperature gradient (warm ↔ cool) that sweeps along
 * world Z over time. A travelling sine maps each pixel's depth to a temperature in
 * [0,1], blended between a warm and a cool hue — like a thermal wave washing the kit.
 */
export const tempSweep: EffectGenerator = {
  id: 'temp-sweep',
  name: 'Temperature Sweep',
  category: 'wash',
  paramSpec: [
    { key: 'kz', label: 'Spatial Freq', type: 'number', default: 0.004, min: 0.0005, max: 0.02, step: 0.0005 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 6, step: 0.05 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const kz = pnum(params, 'kz', 0.004);
    const speed = pnum(params, 'speed', 1);
    const bri = clamp01(pnum(params, 'brightness', 0.8));
    const t = ctx.timeMs * 0.001 * speed;
    const cz = ctx.model.bounds.center.z;

    for (const p of ctx.model.pixels) {
      const temp = 0.5 + 0.5 * Math.sin((p.world.z - cz) * kz - t);
      const hue = lerp(WARM_HUE, COOL_HUE, clamp01(temp));
      const rgb = hsvToRgb(hue, 1, bri);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
