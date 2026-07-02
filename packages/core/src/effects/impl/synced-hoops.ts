import { hsvToRgb } from '../../color/color';
import { clamp01 } from '../../math';
import { pnum, type EffectGenerator } from '../types';

/**
 * Synced Hoops: a hue/brightness wave climbs the hoop levels, driven by transport
 * beat only. Because the color is a pure function of `normHoop` + time, "Hoop 1 is
 * Hoop 1 on every drum" — the same hoop level renders identically across the kit.
 */
export const syncedHoops: EffectGenerator = {
  id: 'synced-hoops',
  name: 'Synced Hoops',
  category: 'base',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 120, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 8, step: 0.05, unit: 'cyc/beat' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 1);
    const hueSpread = pnum(params, 'hueSpread', 120);
    const bri = pnum(params, 'brightness', 1);
    const speed = pnum(params, 'speed', 1);

    // Phase advances with the transport beat so the wave is musically locked.
    const phase = ctx.transport.beat * speed;
    for (const p of ctx.model.pixels) {
      // A travelling brightness wave up the hoop levels (0..1).
      const wave = 0.5 + 0.5 * Math.sin((p.normHoop - phase) * 2 * Math.PI);
      const v = clamp01(bri * wave);
      const h = hue + p.normHoop * hueSpread;
      const rgb = hsvToRgb(h, sat, v);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
