import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Meter / Graphic EQ: hoops light up to a `level` (0..1), which is typically
 * modulated by volume or velocity (design "each hoop is a segment of a Graph.EQ").
 */
export const meterEq: EffectGenerator = {
  id: 'meter-eq',
  name: 'Meter (EQ)',
  category: 'meter',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 110, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'level', label: 'Level', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 90, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 110);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const level = pnum(params, 'level', 0.5);
    const spread = pnum(params, 'hueSpread', 90);
    if (level <= 0) return;

    for (const p of ctx.model.pixels) {
      if (p.normHoop > level) continue;
      const rgb = hsvToRgb(hue + p.normHoop * spread, sat, bri);
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
