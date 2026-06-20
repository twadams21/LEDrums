import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Burst: a hit lights the whole struck drum; the harder the hit the brighter it
 * starts AND the longer it lingers (design "harder you hit it, the longer the note
 * and the brighter/longer the light"). Decay time scales with velocity.
 */
export const burst: EffectGenerator = {
  id: 'burst',
  name: 'Burst',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 20, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'baseDecayMs', label: 'Base Decay', type: 'number', default: 250, min: 20, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 20);
    const bri = pnum(params, 'brightness', 1);
    const baseDecay = Math.max(1, pnum(params, 'baseDecayMs', 250));

    // Track the strongest envelope per drum so overlapping hits max-merge cleanly.
    const perDrum = new Map<string, number>();
    for (const trig of ctx.triggers) {
      if (!ctx.model.drumById.has(trig.drumId)) continue;
      // Harder hits decay slower (longer note): scale from 0.3x..3.3x of baseDecay.
      const decay = baseDecay * (0.3 + trig.velocity * 3);
      const envelope = trig.velocity * Math.exp(-trig.ageMs / decay);
      const prev = perDrum.get(trig.drumId) ?? 0;
      if (envelope > prev) perDrum.set(trig.drumId, envelope);
    }
    if (perDrum.size === 0) return;

    for (const p of ctx.model.pixels) {
      const intensity = perDrum.get(p.drumId);
      if (intensity === undefined || intensity < 0.004) continue;
      const rgb = hsvToRgb(hue, 1, bri * intensity);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, intensity);
    }
  },
};
