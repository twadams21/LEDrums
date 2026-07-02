import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Whole Kit: any hit lights every pixel of the entire kit, fading over decayMs
 * (design "all pixels of the KIT display the same content").
 */
export const wholeKit: EffectGenerator = {
  id: 'whole-kit',
  name: 'Whole Kit',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 50, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 260, min: 10, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 50);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const decay = Math.max(1, pnum(params, 'decayMs', 260));

    let intensity = 0;
    for (const trig of ctx.triggers) {
      intensity = Math.max(intensity, trig.velocity * Math.exp(-trig.ageMs / decay));
    }
    if (intensity < 0.004) return;
    const rgb = hsvToRgb(hue, sat, bri * intensity);
    for (const p of ctx.model.pixels) fb.max(p.id, rgb.r, rgb.g, rgb.b, intensity);
  },
};
