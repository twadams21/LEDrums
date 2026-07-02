import { clamp01, lerp } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Temperature Sweep: a colour-temperature gradient (warm ↔ cool) that sweeps along
 * world Z over time. A travelling sine maps each pixel's depth to a temperature in
 * [0,1], blended between a warm and a cool hue — like a thermal wave washing the kit.
 * Intrinsically two-colour, so it exposes the warm/cool hue endpoints (a range) plus a
 * shared saturation rather than a single hue + swatch.
 */
export const tempSweep: EffectGenerator = {
  id: 'temp-sweep',
  name: 'Temperature Sweep',
  category: 'wash',
  paramSpec: [
    { key: 'warmHue', label: 'Warm Hue', type: 'number', default: 30, min: 0, max: 360, unit: '°' },
    { key: 'coolHue', label: 'Cool Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'kz', label: 'Spatial Freq', type: 'number', default: 0.004, min: 0.0005, max: 0.02, step: 0.0005 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 6, step: 0.05 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const warmHue = pnum(params, 'warmHue', 30);
    const coolHue = pnum(params, 'coolHue', 210);
    const sat = pnum(params, 'saturation', 1);
    const kz = pnum(params, 'kz', 0.004);
    const speed = pnum(params, 'speed', 1);
    const bri = clamp01(pnum(params, 'brightness', 0.8));
    const t = ctx.timeMs * 0.001 * speed;
    const cz = ctx.model.bounds.center.z;

    for (const p of ctx.model.pixels) {
      const temp = 0.5 + 0.5 * Math.sin((p.world.z - cz) * kz - t);
      const hue = lerp(warmHue, coolHue, clamp01(temp));
      const rgb = hsvToRgb(hue, sat, bri);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
