import { hsvToRgb } from '../../color/color';
import { clamp01, wrap } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

interface GravityDropData {
  angleDeg: number;
  hueOffset: number;
}

export interface GravityDropsState {
  em: EmitterState<GravityDropData>;
}

/**
 * Gravity Drops: every hit drops a glowing bead down the struck drum. Unlike ambient rain,
 * this is per-hit and drum-local; accents create stacked falling trails that visibly obey
 * the hoop layout.
 */
export const gravityDrops: EffectGenerator<GravityDropsState> = {
  id: 'gravity-drops',
  name: 'Gravity Drops',
  category: 'particle',
  timebase: 'voice',
  description:
    'Each hit releases a glowing bead that falls down the struck drum under gravity, leaving a short trail across the hoop stack.',
  tags: ['particle', 'hit', 'per-drum', 'hoop-aware', 'emission'],
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 214, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'fallSpeed', label: 'Fall Speed', type: 'number', default: 0.9, min: 0.05, max: 4, step: 0.05, unit: 'drum/s' },
    { key: 'gravity', label: 'Gravity', type: 'number', default: 0.7, min: 0, max: 4, step: 0.05, unit: 'drum/s²' },
    { key: 'trail', label: 'Trail', type: 'number', default: 0.22, min: 0.04, max: 0.75, step: 0.01 },
    { key: 'spreadDeg', label: 'Spread', type: 'number', default: 42, min: 8, max: 180, unit: '°' },
    { key: 'lifeMs', label: 'Life', type: 'number', default: 1900, min: 200, max: 6000, step: 50, unit: 'ms' },
  ],
  createState(): GravityDropsState {
    return { em: createEmitterState<GravityDropData>() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 214);
    const sat = pnum(params, 'saturation', 0.9);
    const bri = pnum(params, 'brightness', 1);
    const fallSpeed = Math.max(0.001, pnum(params, 'fallSpeed', 0.9));
    const gravity = Math.max(0, pnum(params, 'gravity', 0.7));
    const trail = Math.max(0.001, pnum(params, 'trail', 0.22));
    const spreadDeg = Math.max(1, pnum(params, 'spreadDeg', 42));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1900));
    const emissions = updateEmissions(state.em, ctx, lifeMs, (trig) => ({
      angleDeg: (trig.note * 23 + trig.seq * 37) % 360,
      hueOffset: (trig.seq % 9) * 8,
    }));

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const t = em.ageMs / 1000;
      const fall = t * fallSpeed + 0.5 * gravity * t * t;
      const head = 1 - fall;
      const fade = clamp01(1 - em.ageMs / lifeMs) * em.velocity * bri;
      if (fade < 0.004 || head < -trail) continue;
      const end = drum.pixelStart + drum.pixelCount;
      for (let i = drum.pixelStart; i < end; i++) {
        const p = ctx.model.pixels[i]!;
        const vertical = head - p.normHoop;
        if (vertical < 0 || vertical > trail) continue;
        const angle = Math.min(wrap(p.angleDeg - em.data.angleDeg, 360), wrap(em.data.angleDeg - p.angleDeg, 360));
        if (angle > spreadDeg) continue;
        const tail = 1 - vertical / trail;
        const angular = 1 - angle / spreadDeg;
        const v = clamp01(fade * tail * tail * angular);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue + em.data.hueOffset + p.normHoop * 35, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
