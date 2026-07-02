import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Strobe / Flash: the whole kit flashes on and off at a fixed rate. A momentary
 * trigger-style effect (design "Could just be a flash").
 *
 * Voice timebase (S26): the on/off phase reads `ctx.timeMs`, which the bridge makes
 * hit-relative, so a hit starts the strobe "on" (age 0 → first half of the period) and
 * a retrigger restarts it. No body change — the bridge swaps the clock.
 */
export const strobe: EffectGenerator = {
  id: 'strobe',
  name: 'Strobe',
  category: 'utility',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'rate', label: 'Rate', type: 'number', default: 8, min: 0.5, max: 30, step: 0.5, unit: 'Hz' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 0);
    const sat = pnum(params, 'saturation', 0);
    const bri = pnum(params, 'brightness', 1);
    const rate = Math.max(0.01, pnum(params, 'rate', 8));

    // Full strobe period = 1/rate; first half on, second half off.
    const on = Math.floor(ctx.timeMs * 0.001 * rate * 2) % 2 === 0;
    if (!on) return;
    const rgb = hsvToRgb(hue, sat, bri);
    for (const p of ctx.model.pixels) fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
  },
};
