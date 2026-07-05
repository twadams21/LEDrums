import { hsvToRgb } from '../../color/color';
import { clamp01, type Vec3 } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, pstr, type EffectGenerator } from '../types';

interface ScanPlaneData {
  dir: number;
  axisOffset: number;
}

export interface ScanPlaneState {
  em: EmitterState<ScanPlaneData>;
}

function coord(v: Vec3, axis: string): number {
  return axis === 'y' ? v.y : axis === 'z' ? v.z : v.x;
}

/**
 * Scan Plane: every hit emits a 3D plane that sweeps across the entire kit. The plane is
 * authored against real world coordinates, so it cuts through the negative space between drums
 * before reaching other shells.
 */
export const scanPlane: EffectGenerator<ScanPlaneState> = {
  id: 'scan-plane',
  name: 'Scan Plane',
  category: 'trigger',
  timebase: 'voice',
  description:
    'Every hit launches a bright 3D scanning plane through the kit; the band crosses the gaps between drums before slicing across the next shell.',
  tags: ['wave', 'hit', '3d', 'kit-wide', 'airspace', 'emission'],
  paramSpec: [
    { key: 'axis', label: 'Axis', type: 'enum', default: 'x', options: ['x', 'y', 'z'] },
    { key: 'hue', label: 'Hue', type: 'number', default: 180, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.95, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1000, min: 80, max: 5000, step: 10, unit: 'mm/s' },
    { key: 'width', label: 'Width', type: 'number', default: 160, min: 20, max: 800, step: 10, unit: 'mm' },
    { key: 'afterglow', label: 'Afterglow', type: 'number', default: 0.28, min: 0, max: 1, step: 0.01 },
    { key: 'lifeMs', label: 'Life', type: 'number', default: 1700, min: 200, max: 6000, step: 50, unit: 'ms' },
  ],
  createState(): ScanPlaneState {
    return { em: createEmitterState<ScanPlaneData>() };
  },
  render(ctx, params, fb, state) {
    const axis = pstr(params, 'axis', 'x');
    const hue = pnum(params, 'hue', 180);
    const sat = pnum(params, 'saturation', 0.95);
    const bri = pnum(params, 'brightness', 1);
    const speed = Math.max(1, pnum(params, 'speed', 1000));
    const width = Math.max(1, pnum(params, 'width', 160));
    const afterglow = clamp01(pnum(params, 'afterglow', 0.28));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1700));
    const emissions = updateEmissions(state.em, ctx, lifeMs, (trig) => ({
      dir: trig.seq % 2 === 0 ? -1 : 1,
      axisOffset: ((trig.note % 7) - 3) * width * 0.12,
    }));

    if (emissions.length === 0) return;
    const min = coord(ctx.model.bounds.min, axis);
    const max = coord(ctx.model.bounds.max, axis);
    const span = Math.max(1, max - min);
    const low = min - span * 0.25;
    const high = max + span * 0.25;

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      const origin = drum ? coord(drum.effectOriginWorld, axis) : (low + high) * 0.5;
      const travel = (speed * em.ageMs) / 1000;
      const head = origin + em.data.dir * travel + em.data.axisOffset;
      const fade = clamp01(1 - em.ageMs / lifeMs) * em.velocity * bri;
      if (fade < 0.004) continue;
      for (const p of ctx.model.pixels) {
        const d = Math.abs(coord(p.world, axis) - head);
        if (d > width) continue;
        const front = 1 - d / width;
        const side = clamp01((coord(p.world, axis) - low) / Math.max(1, high - low));
        const glow = front * front + afterglow * front;
        const v = clamp01(glow * fade);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue + side * 60 + em.ageMs * 0.01, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
