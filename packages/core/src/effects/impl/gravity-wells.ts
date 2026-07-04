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
  /** Seeded hue fraction (0..1); mapped to an absolute hue via baseHue + hueRand*hueSpan. */
  hueRand: number;
}

export interface GravityWellsState {
  wells: Well[];
  /** Kit bounds captured at create time so wells drift within kit space. */
  center: Vec3;
  half: Vec3;
  /** Per-frame scratch (one slot per seeded well) so render allocates nothing. */
  scratchPositions: Vec3[];
  scratchHues: number[];
}

const SEED = 0x1234abcd;

/**
 * Gravity Wells: a handful of attractors drift on slow, seeded paths through the
 * kit's bounding volume. Each pixel is colored by proximity to its nearest well —
 * closer is brighter, and the hue is the nearest well's hue. Stateful + seeded so
 * the drifting paths replay identically across engines (R13).
 *
 * Voice timebase (S26): the well positions read `ctx.timeMs` (hit-relative via the
 * bridge), so the wells start at their seeded phase on the hit and restart on retrigger.
 * Per-voice `genState` (seeded wells + captured kit bounds) is reset on (re)spawn → the
 * drift replays identically from t=0, no state leaks across voices.
 */
export const gravityWells: EffectGenerator<GravityWellsState> = {
  id: 'gravity-wells',
  name: 'Gravity Wells',
  category: 'wash',
  timebase: 'voice',
  paramSpec: [
    { key: 'wells', label: 'Wells', type: 'number', default: 3, min: 1, max: 6, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
    { key: 'reach', label: 'Reach', type: 'number', default: 600, min: 50, max: 3000, unit: 'mm' },
    { key: 'baseHue', label: 'Base Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'hueSpan', label: 'Hue Span', type: 'number', default: 360, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel, seed?: number): GravityWellsState {
    const rng = mulberry32(seed ?? SEED);
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
        hueRand: rng(),
      });
    }
    const { center, size } = model.bounds;
    // Half-extents: fall back to a sane radius if the kit is degenerate (single hoop).
    const half: Vec3 = {
      x: Math.max((model.bounds.max.x - model.bounds.min.x) / 2, size * 0.25, 100),
      y: Math.max((model.bounds.max.y - model.bounds.min.y) / 2, size * 0.25, 100),
      z: Math.max((model.bounds.max.z - model.bounds.min.z) / 2, size * 0.25, 100),
    };
    return {
      wells,
      center: { ...center },
      half,
      scratchPositions: wells.map(() => ({ x: 0, y: 0, z: 0 })),
      scratchHues: wells.map(() => 0),
    };
  },
  render(ctx, params, fb, state) {
    const wellCount = Math.max(1, Math.min(state.wells.length, Math.round(pnum(params, 'wells', 3))));
    const speed = pnum(params, 'speed', 0.2);
    const reach = Math.max(1, pnum(params, 'reach', 600));
    // Multi-colour: each well's seeded fraction maps to [baseHue, baseHue + hueSpan].
    // Defaults (baseHue 0, hueSpan 360) reproduce the old per-well `rng() * 360` exactly.
    const baseHue = pnum(params, 'baseHue', 0);
    const hueSpan = pnum(params, 'hueSpan', 360);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 0.9);
    const t = ctx.timeMs * 0.001 * speed;

    // Position each active well along its slow seeded Lissajous path within the kit,
    // and resolve its absolute hue from the current base/span. Scratch buffers are
    // pre-allocated in state and overwritten each frame — no per-frame allocation.
    const positions = (state.scratchPositions ??= state.wells.map(() => ({ x: 0, y: 0, z: 0 })));
    const hues = (state.scratchHues ??= state.wells.map(() => 0));
    for (let i = 0; i < wellCount; i++) {
      const w = state.wells[i]!;
      const pos = positions[i]!;
      pos.x = state.center.x + state.half.x * 0.8 * Math.sin(t * w.freqX + w.phaseX);
      pos.y = state.center.y + state.half.y * 0.8 * Math.sin(t * w.freqY + w.phaseY);
      pos.z = state.center.z + state.half.z * 0.8 * Math.sin(t * w.freqZ + w.phaseZ);
      hues[i] = baseHue + w.hueRand * hueSpan;
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
          bestHue = hues[i]!;
        }
      }
      const v = clamp01(bri * bestV);
      if (v < 0.004) continue;
      const rgb = hsvToRgb(bestHue, sat, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
