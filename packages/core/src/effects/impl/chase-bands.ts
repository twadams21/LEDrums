import { hsvToRgb } from '../../color/color';
import { clamp01, wrap } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

export interface ChaseBandsState {
  em: EmitterState;
}

/**
 * Chase Bands: every hit launches a band of light that races around the struck
 * drum's hoops, sized and paced musically — width as a fraction of the hoop,
 * speed in revolutions per beat. Hits layer: strike on four consecutive beats at
 * speed 1/4 and the hoop fills with four evenly-spaced bands chasing each other
 * (the behaviour the original beat-indexed Chase could not do — it rendered one
 * global step and repeated hits just restacked it).
 *
 * `twist` skews the band's angle per hoop, turning the flat band into a helical
 * ribbon that corkscrews up the drum — a shape that only reads on a real 3D
 * hoop stack. Deterministic: pure function of trigger ages, no RNG.
 */
export const chaseBands: EffectGenerator<ChaseBandsState> = {
  id: 'chase-bands',
  name: 'Chase Bands',
  category: 'trigger',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 30, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.25, min: 0.05, max: 4, step: 0.05, unit: 'rev/beat' },
    { key: 'bandWidth', label: 'Band Width', type: 'number', default: 0.25, min: 0.02, max: 1, step: 0.01, unit: 'hoop' },
    { key: 'lifeBeats', label: 'Life', type: 'number', default: 4, min: 0.5, max: 16, step: 0.5, unit: 'beats' },
    { key: 'twist', label: 'Twist', type: 'number', default: 0, min: -90, max: 90, unit: '°/hoop' },
    { key: 'hueDrift', label: 'Hue Drift', type: 'number', default: 0, min: 0, max: 360, unit: '°/rev' },
  ],
  createState(): ChaseBandsState {
    return { em: createEmitterState() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 30);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const speed = Math.max(0.001, pnum(params, 'speed', 0.25));
    const bandDeg = Math.max(1, pnum(params, 'bandWidth', 0.25) * 360);
    const lifeBeats = Math.max(0.1, pnum(params, 'lifeBeats', 4));
    const twist = pnum(params, 'twist', 0);
    const hueDrift = pnum(params, 'hueDrift', 0);

    const bpm = ctx.transport.bpm || 120;
    const msPerBeat = 60000 / bpm;
    const emissions = updateEmissions(state.em, ctx, lifeBeats * msPerBeat, () => undefined);

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const ageBeats = em.ageMs / msPerBeat;
      const revs = ageBeats * speed;
      const headDeg = revs * 360; // travels with the hoop's winding direction
      const fade = clamp01(1 - ageBeats / lifeBeats);
      const level = fade * em.velocity * bri;
      if (level < 0.004) continue;
      const bandHue = hue + revs * hueDrift;
      const end = drum.pixelStart + drum.pixelCount;
      for (let i = drum.pixelStart; i < end; i++) {
        const p = ctx.model.pixels[i]!;
        // Positive angular distance BEHIND the head (comet tail); helical twist
        // offsets each hoop so the band corkscrews up the shell.
        const behind = wrap(headDeg - (p.angleDeg + twist * p.hoopIndex), 360);
        if (behind > bandDeg) continue;
        const v = clamp01(level * (1 - behind / bandDeg));
        if (v < 0.004) continue;
        const rgb = hsvToRgb(bandHue, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
