import { hsvToRgb } from '../../color/color';
import { clamp01, wrap } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

interface DrumSonarData {
  angleOffset: number;
}

export interface DrumSonarState {
  em: EmitterState<DrumSonarData>;
}

/**
 * Drum Sonar: every hit pings the struck drum with expanding hoop-level rings and a subtle
 * angular sweep. It reads like a radar return mapped onto the physical hoop stack.
 */
export const drumSonar: EffectGenerator<DrumSonarState> = {
  id: 'drum-sonar',
  name: 'Drum Sonar',
  category: 'trigger',
  timebase: 'voice',
  description:
    'Every hit pings the struck drum with expanding hoop-level sonar rings and a faint angular sweep, turning the shell into a radar display.',
  tags: ['wave', 'hit', 'per-drum', 'hoop-aware', 'emission'],
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 168, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.2, min: 0.05, max: 6, step: 0.05, unit: 'drum/s' },
    { key: 'ringWidth', label: 'Ring Width', type: 'number', default: 0.12, min: 0.02, max: 0.5, step: 0.01 },
    { key: 'sweepWidth', label: 'Sweep Width', type: 'number', default: 70, min: 10, max: 240, unit: '°' },
    { key: 'lifeMs', label: 'Life', type: 'number', default: 1500, min: 150, max: 5000, step: 50, unit: 'ms' },
    { key: 'echoes', label: 'Echoes', type: 'number', default: 3, min: 1, max: 5, step: 1 },
  ],
  createState(): DrumSonarState {
    return { em: createEmitterState<DrumSonarData>() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 168);
    const sat = pnum(params, 'saturation', 0.9);
    const bri = pnum(params, 'brightness', 1);
    const speed = Math.max(0.001, pnum(params, 'speed', 1.2));
    const ringWidth = Math.max(0.001, pnum(params, 'ringWidth', 0.12));
    const sweepWidth = Math.max(1, pnum(params, 'sweepWidth', 70));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1500));
    const echoes = Math.max(1, Math.round(pnum(params, 'echoes', 3)));
    const emissions = updateEmissions(state.em, ctx, lifeMs, (trig) => ({ angleOffset: (trig.note * 17 + trig.seq * 29) % 360 }));

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const age = em.ageMs / 1000;
      const head = age * speed;
      const sweepHead = em.data.angleOffset + age * 220;
      const fade = clamp01(1 - em.ageMs / lifeMs) * em.velocity * bri;
      if (fade < 0.004) continue;
      const end = drum.pixelStart + drum.pixelCount;
      for (let i = drum.pixelStart; i < end; i++) {
        const p = ctx.model.pixels[i]!;
        let ring = 0;
        for (let e = 0; e < echoes; e++) {
          const center = head - e * 0.22;
          if (center < -ringWidth) break;
          const d = Math.abs(p.normHoop - center);
          if (d > ringWidth) continue;
          const g = 1 - d / ringWidth;
          const level = g * g * (e === 0 ? 1 : 0.55 / e);
          if (level > ring) ring = level;
        }
        if (ring <= 0) continue;
        const behind = wrap(sweepHead - p.angleDeg, 360);
        const sweep = behind < sweepWidth ? 1 - behind / sweepWidth : 0.25;
        const v = clamp01(ring * sweep * fade);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue + p.normHoop * 55, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
