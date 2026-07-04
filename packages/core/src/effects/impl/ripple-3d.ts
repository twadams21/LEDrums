import { hsvToRgb } from '../../color/color';
import { clamp01, distance } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

export interface Ripple3dState {
  em: EmitterState;
}

/**
 * Ripple 3D: every hit detonates a spherical wavefront in WORLD space from the
 * struck drum's origin — it expands through the air and washes across the OTHER
 * drums as it reaches them, making the kit read as one physical object in a room
 * rather than four independent screens. Trailing echo rings follow the front;
 * hue shifts with travelled distance so far waves arrive colour-aged.
 *
 * Hits layer as concurrent emissions: two hits on different drums produce two
 * interfering wavefronts (max-composited). Deterministic: pure function of
 * trigger ages, no RNG.
 */
export const ripple3d: EffectGenerator<Ripple3dState> = {
  id: 'ripple-3d',
  name: 'Ripple 3D',
  category: 'trigger',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 190, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Wave Speed', type: 'number', default: 900, min: 100, max: 4000, step: 10, unit: 'mm/s' },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 140, min: 20, max: 600, unit: 'mm' },
    { key: 'rings', label: 'Echo Rings', type: 'number', default: 2, min: 1, max: 4, step: 1 },
    { key: 'lifeMs', label: 'Life', type: 'number', default: 1600, min: 200, max: 6000, unit: 'ms' },
    { key: 'hueShift', label: 'Hue Shift', type: 'number', default: 50, min: 0, max: 360, unit: '°/m' },
  ],
  createState(): Ripple3dState {
    return { em: createEmitterState() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 190);
    const sat = pnum(params, 'saturation', 0.9);
    const bri = pnum(params, 'brightness', 1);
    const speed = Math.max(1, pnum(params, 'speed', 900));
    const thickness = Math.max(1, pnum(params, 'thickness', 140));
    const rings = Math.max(1, Math.round(pnum(params, 'rings', 2)));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1600));
    const hueShiftPerMm = pnum(params, 'hueShift', 50) / 1000;

    const emissions = updateEmissions(state.em, ctx, lifeMs, () => undefined);
    if (emissions.length === 0) return;
    const ringSpacing = thickness * 2.5;

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const origin = drum.effectOriginWorld;
      const radius = (speed * em.ageMs) / 1000;
      const fade = clamp01(1 - em.ageMs / lifeMs);
      const level = fade * em.velocity * bri;
      if (level < 0.004) continue;
      for (const p of ctx.model.pixels) {
        const d = distance(p.world, origin);
        // Strongest ring at this pixel: front at `radius`, dimmer echoes trailing behind.
        let best = 0;
        for (let k = 0; k < rings; k++) {
          const rd = radius - k * ringSpacing;
          if (rd < 0) break;
          const x = Math.abs(d - rd) / thickness;
          if (x >= 1) continue;
          const g = 1 - x;
          const ringLevel = g * g * (k === 0 ? 1 : 0.6 / k);
          if (ringLevel > best) best = ringLevel;
        }
        if (best <= 0) continue;
        const v = clamp01(level * best);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue + d * hueShiftPerMm, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
