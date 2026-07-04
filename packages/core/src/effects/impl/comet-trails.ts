import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32, wrap } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

interface Comet {
  drumId: string;
  hoopIndex: number;
  /** Current head angle (degrees). */
  angle: number;
  /** Hue offset (degrees) so comets differ slightly. */
  hueOffset: number;
  /** Direction (+1 / -1). */
  dir: number;
}

export interface CometTrailsState {
  comets: Comet[];
  /** Comet count the array was seeded for (re-seed if `comets` param changes). */
  seededCount: number;
  /** Whether the drum layout has been bound yet. */
  bound: boolean;
  /** The per-voice seed the comets were built from (item C) — reused when count changes. */
  seed: number;
}

const SEED = 0xc0117a11;

/** Signed smallest angular delta from `from` to `to`, in [-180, 180]. */
function angularDelta(from: number, to: number): number {
  let d = wrap(to - from, 360);
  if (d > 180) d -= 360;
  return d;
}

function seedComets(model: PixelModel, count: number, seed: number): Comet[] {
  const rng = mulberry32(seed);
  const comets: Comet[] = [];
  if (model.drums.length === 0) return comets;
  for (let k = 0; k < count; k++) {
    const drum = model.drums[Math.floor(rng() * model.drums.length) % model.drums.length]!;
    const hoopIndex = Math.floor(rng() * Math.max(1, drum.hoopCount)) % Math.max(1, drum.hoopCount);
    comets.push({
      drumId: drum.drumId,
      hoopIndex,
      angle: rng() * 360,
      hueOffset: rng() * 60 - 30,
      dir: rng() < 0.5 ? -1 : 1,
    });
  }
  return comets;
}

/**
 * Comet Trails: a handful of seeded comets orbit around individual hoops, advancing
 * their head angle each frame. Pixels near the head light brightest, with a fading
 * tail trailing behind by angular distance. Stateful so the orbit advances per dt.
 *
 * Voice timebase (S26): the orbit accumulates on `ctx.dt` (real frame delta, unchanged by
 * timebase) into per-voice `genState`, and the comets are seeded at their start angles in
 * `createState`. `genState` is reset on (re)spawn, so a retrigger restarts every comet from
 * its seeded angle — the orbit replays identically and no state leaks across voices.
 */
export const cometTrails: EffectGenerator<CometTrailsState> = {
  id: 'comet-trails',
  name: 'Comet Trails',
  category: 'particle',
  timebase: 'voice',
  paramSpec: [
    { key: 'comets', label: 'Comets', type: 'number', default: 4, min: 1, max: 32, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 180, min: 0, max: 1080, unit: '°/s' },
    { key: 'tail', label: 'Tail', type: 'number', default: 120, min: 5, max: 350, unit: '°' },
    { key: 'hue', label: 'Hue', type: 'number', default: 190, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel, seed?: number): CometTrailsState {
    const count = 4;
    const s = seed ?? SEED;
    return { comets: seedComets(model, count, s), seededCount: count, bound: true, seed: s };
  },
  render(ctx, params, fb, state) {
    const count = Math.max(1, Math.round(pnum(params, 'comets', 4)));
    const speed = pnum(params, 'speed', 180);
    const tail = Math.max(1, pnum(params, 'tail', 120));
    const hue = pnum(params, 'hue', 190);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);

    // Re-seed if comet count changed or state is unbound.
    if (!state.bound || state.seededCount !== count) {
      state.comets = seedComets(ctx.model, count, state.seed ?? SEED);
      state.seededCount = count;
      state.bound = true;
    }

    // Advance each comet head by speed * dt.
    const dAngle = (speed * ctx.dt) / 1000;
    for (const comet of state.comets) {
      comet.angle = wrap(comet.angle + comet.dir * dAngle, 360);
    }

    for (const comet of state.comets) {
      const drum = ctx.model.drumById.get(comet.drumId);
      if (!drum) continue;
      const cometHue = hue + comet.hueOffset;
      for (let p = drum.pixelStart; p < drum.pixelStart + drum.pixelCount; p++) {
        const pix = ctx.model.pixels[p]!;
        if (pix.hoopIndex !== comet.hoopIndex) continue;
        // Behind-the-head distance: measured opposite the travel direction.
        let behind = comet.dir * angularDelta(comet.angle, pix.angleDeg);
        // `behind` < 0 means the pixel is behind the head (in the tail); negate so tail is positive.
        behind = -behind;
        if (behind < 0) {
          // Tiny lead glow just ahead of the head.
          if (behind > -8) {
            const v = clamp01(bri * (1 + behind / 8));
            if (v >= 0.004) {
              const rgb = hsvToRgb(cometHue, sat, v);
              fb.max(p, rgb.r, rgb.g, rgb.b, v);
            }
          }
          continue;
        }
        if (behind > tail) continue;
        const falloff = 1 - behind / tail;
        const v = clamp01(bri * falloff * falloff);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(cometHue, sat, v);
        fb.max(p, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
