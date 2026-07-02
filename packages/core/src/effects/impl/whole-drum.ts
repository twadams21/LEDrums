import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Whole Drum: a hit lights every pixel of the struck drum, fading over decayMs
 * (design "all pixels of the DRUM display the same content").
 */
export const wholeDrum: EffectGenerator = {
  id: 'whole-drum',
  name: 'Whole Drum',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 220, min: 10, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 0);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const decay = Math.max(1, pnum(params, 'decayMs', 220));

    for (const trig of ctx.triggers) {
      const intensity = trig.velocity * Math.exp(-trig.ageMs / decay);
      if (intensity < 0.004) continue;
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      const rgb = hsvToRgb(hue, sat, bri * intensity);
      for (let id = drum.pixelStart; id < drum.pixelStart + drum.pixelCount; id++) {
        fb.max(id, rgb.r, rgb.g, rgb.b, intensity);
      }
    }
  },
};
