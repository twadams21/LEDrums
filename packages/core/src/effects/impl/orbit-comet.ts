import { hsvToRgb } from '../../color/color';
import { clamp01, wrap } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

interface OrbitCometData {
  spin: number;
  hueOffset: number;
  hoopPhase: number;
}

export interface OrbitCometState {
  em: EmitterState<OrbitCometData>;
}

/**
 * Orbit Comet: every hit launches a comet around the struck drum's hoops. The head orbits
 * angularly while a hoop-phase offset climbs the stack, so the tail corkscrews rather than
 * reading as a flat chase. Multiple hits are independent emissions and layer cleanly.
 */
export const orbitComet: EffectGenerator<OrbitCometState> = {
  id: 'orbit-comet',
  name: 'Orbit Comet',
  category: 'particle',
  timebase: 'voice',
  description:
    'Every hit launches a comet around the struck drum; its tail corkscrews up the hoop stack so one strike reads as a physical orbit, not a flat blink.',
  tags: ['particle', 'hit', 'per-drum', 'hoop-aware', 'emission', 'seeded'],
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 198, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.95, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.8, min: 0.05, max: 4, step: 0.05, unit: 'rev/beat' },
    { key: 'tailDeg', label: 'Tail', type: 'number', default: 110, min: 12, max: 360, unit: '°' },
    { key: 'lifeBeats', label: 'Life', type: 'number', default: 3, min: 0.25, max: 12, step: 0.25, unit: 'beats' },
    { key: 'riseDeg', label: 'Hoop Rise', type: 'number', default: 34, min: -120, max: 120, unit: '°/hoop' },
    { key: 'hueDrift', label: 'Hue Drift', type: 'number', default: 70, min: 0, max: 360, unit: '°/rev' },
  ],
  createState(): OrbitCometState {
    return { em: createEmitterState<OrbitCometData>() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 198);
    const sat = pnum(params, 'saturation', 0.95);
    const bri = pnum(params, 'brightness', 1);
    const speed = Math.max(0.001, pnum(params, 'speed', 0.8));
    const tailDeg = Math.max(1, pnum(params, 'tailDeg', 110));
    const lifeBeats = Math.max(0.05, pnum(params, 'lifeBeats', 3));
    const riseDeg = pnum(params, 'riseDeg', 34);
    const hueDrift = pnum(params, 'hueDrift', 70);
    const bpm = ctx.transport.bpm || 120;
    const msPerBeat = 60000 / bpm;

    const emissions = updateEmissions(state.em, ctx, lifeBeats * msPerBeat, (trig) => ({
      spin: trig.seq % 2 === 0 ? -1 : 1,
      hueOffset: (trig.note % 12) * 12,
      hoopPhase: (trig.seq % 7) * 11,
    }));

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const ageBeats = em.ageMs / msPerBeat;
      const revs = ageBeats * speed;
      const headDeg = em.data.spin * revs * 360 + em.data.hoopPhase;
      const fade = clamp01(1 - ageBeats / lifeBeats);
      const level = fade * fade * em.velocity * bri;
      if (level < 0.004) continue;
      const end = drum.pixelStart + drum.pixelCount;
      for (let i = drum.pixelStart; i < end; i++) {
        const p = ctx.model.pixels[i]!;
        const localHead = headDeg + riseDeg * (p.hoopIndex - 1); // hoopIndex is 1-based (A1)
        const behind = wrap(localHead - p.angleDeg, 360);
        if (behind > tailDeg) continue;
        const tail = 1 - behind / tailDeg;
        const hoopFocus = 0.65 + 0.35 * Math.sin((p.normHoop + ageBeats * 0.17) * Math.PI);
        const v = clamp01(level * tail * tail * hoopFocus);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue + em.data.hueOffset + revs * hueDrift, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
