import { clamp01, distance, mulberry32, type Vec3 } from '../../math';
import { hsvToRgb } from '../../color/color';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

interface Well {
  /** Independent phase offsets so each well traces its own slow path. */
  phaseX: number;
  phaseY: number;
  phaseZ: number;
  freqX: number;
  freqY: number;
  freqZ: number;
  hue: number;
}

export interface GravityWellsState {
  wells: Well[];
  /** Kit bounds captured at create time so wells drift within kit space. */
  center: Vec3;
  half: Vec3;
}

const SEED = 0x1234abcd;

/**
 * Gravity Wells: a handful of attractors drift on slow, seeded paths through the
 * kit's bounding volume. Each pixel is colored by proximity to its nearest well —
 * closer is brighter, and the hue is the nearest well's hue. Stateful + seeded so
 * the drifting paths replay identically across engines (R13).
 */
export const gravityWells: EffectGenerator<GravityWellsState> = {
  id: 'gravity-wells',
  name: 'Gravity Wells',
  category: 'wash',
  paramSpec: [
    { key: 'wells', label: 'Wells', type: 'number', default: 3, min: 1, max: 6, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
    { key: 'reach', label: 'Reach', type: 'number', default: 600, min: 50, max: 3000, unit: 'mm' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel): GravityWellsState {
    const rng = mulberry32(SEED);
    const wells: Well[] = [];
    // Build the maximum number of wells; render uses the first `wells` of them so
    // changing the param at runtime never reshuffles the seeded paths.
    for (let i = 0; i < 6; i++) {
      wells.push({
        phaseX: rng() * Math.PI * 2,
        phaseY: rng() * Math.PI * 2,
        phaseZ: rng() * Math.PI * 2,
        // Low, irrational-ish frequencies so paths never repeat in lockstep.
        freqX: 0.3 + rng() * 0.7,
        freqY: 0.3 + rng() * 0.7,
        freqZ: 0.3 + rng() * 0.7,
        hue: rng() * 360,
      });
    }
    const { center, size } = model.bounds;
    // Half-extents: fall back to a sane radius if the kit is degenerate (single hoop).
    const half: Vec3 = {
      x: Math.max((model.bounds.max.x - model.bounds.min.x) / 2, size * 0.25, 100),
      y: Math.max((model.bounds.max.y - model.bounds.min.y) / 2, size * 0.25, 100),
      z: Math.max((model.bounds.max.z - model.bounds.min.z) / 2, size * 0.25, 100),
    };
    return { wells, center: { ...center }, half };
  },
  render(ctx, params, fb, state) {
    const wellCount = Math.max(1, Math.min(state.wells.length, Math.round(pnum(params, 'wells', 3))));
    const speed = pnum(params, 'speed', 0.2);
    const reach = Math.max(1, pnum(params, 'reach', 600));
    const bri = pnum(params, 'brightness', 0.9);
    const t = ctx.timeMs * 0.001 * speed;

    // Position each active well along its slow seeded Lissajous path within the kit.
    const positions: Vec3[] = [];
    for (let i = 0; i < wellCount; i++) {
      const w = state.wells[i]!;
      positions.push({
        x: state.center.x + state.half.x * 0.8 * Math.sin(t * w.freqX + w.phaseX),
        y: state.center.y + state.half.y * 0.8 * Math.sin(t * w.freqY + w.phaseY),
        z: state.center.z + state.half.z * 0.8 * Math.sin(t * w.freqZ + w.phaseZ),
      });
    }

    for (const p of ctx.model.pixels) {
      let bestV = 0;
      let bestHue = 0;
      for (let i = 0; i < wellCount; i++) {
        const d = distance(p.world, positions[i]!);
        // Closer = brighter; smooth falloff to zero at `reach`.
        const v = 1 - d / reach;
        if (v > bestV) {
          bestV = v;
          bestHue = state.wells[i]!.hue;
        }
      }
      const v = clamp01(bri * bestV);
      if (v < 0.004) continue;
      const rgb = hsvToRgb(bestHue, 1, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
