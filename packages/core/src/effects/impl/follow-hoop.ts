import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Follow Hoop: a hit lights hoop 0 immediately; each higher hoop lights after a
 * cumulative delay, producing a cascade up the drum (design "Hoop 2 follows 1...").
 * 0ms delay collapses to the Whole-Drum effect.
 */
export const followHoop: EffectGenerator = {
  id: 'follow-hoop',
  name: 'Follow Hoop',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 140, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'delayMs', label: 'Hoop Delay', type: 'number', default: 90, min: 0, max: 1000, unit: 'ms' },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 300, min: 10, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 140);
    const bri = pnum(params, 'brightness', 1);
    const delay = Math.max(0, pnum(params, 'delayMs', 90));
    const decay = Math.max(1, pnum(params, 'decayMs', 300));

    for (const trig of ctx.triggers) {
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      for (const p of ctx.model.pixels) {
        if (p.drumId !== trig.drumId) continue;
        const localAge = trig.ageMs - p.hoopIndex * delay;
        if (localAge < 0) continue;
        const intensity = trig.velocity * Math.exp(-localAge / decay);
        if (intensity < 0.004) continue;
        const rgb = hsvToRgb(hue, 1, bri * intensity);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, intensity);
      }
    }
  },
};
