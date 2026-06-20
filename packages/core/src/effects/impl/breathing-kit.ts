import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Breathing Kit: a calm base layer where the whole kit slowly "breathes" — a single
 * sine LFO drives brightness in and out while the hue drifts subtly around `hue`.
 * Every pixel shares the same value, so the kit pulses as one calm body.
 */
export const breathingKit: EffectGenerator = {
  id: 'breathing-kit',
  name: 'Breathing Kit',
  category: 'base',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'rate', label: 'Rate', type: 'number', default: 0.1, min: 0.01, max: 2, step: 0.01, unit: 'Hz' },
    { key: 'depth', label: 'Depth', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 200);
    const rate = pnum(params, 'rate', 0.1);
    const depth = clamp01(pnum(params, 'depth', 0.5));
    const bri = pnum(params, 'brightness', 0.6);
    const sat = pnum(params, 'saturation', 0.6);

    const phase = ctx.timeMs * 0.001 * rate * Math.PI * 2;
    // Breath LFO: 0..1, never dips fully dark unless depth=1.
    const breath = 0.5 + 0.5 * Math.sin(phase);
    const v = clamp01(bri * (1 - depth + depth * breath));
    // Subtle hue drift, a few degrees, on a slower offset so colour gently wanders.
    const driftHue = hue + 8 * Math.sin(phase * 0.5);
    const rgb = hsvToRgb(driftHue, sat, v);

    for (const p of ctx.model.pixels) {
      fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
