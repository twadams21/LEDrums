import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32, wrap } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

export interface SacredHogsState {
  /** Seeded RNG driving the halo sparkle. */
  rng: () => number;
  /** Per-pixel sparkle level for the top hoop, decays each frame. */
  sparkle: Float32Array;
}

const SEED = 0x5ac8ed00;

/** Smallest angular separation between two angles (degrees), 0..180. */
function angularDist(a: number, b: number): number {
  const d = Math.abs(wrap(a, 360) - wrap(b, 360));
  return d > 180 ? 360 - d : d;
}

/**
 * Sacred HOGs: the top hoop of each drum sparkles orange like a halo, while every
 * hoop below it carries a set of "hogs" — bright nodes that circle around the hoop
 * over time. Pixels near a hog angle light up. Stateful (seeded sparkle).
 *
 * Voice timebase (S26): the hog travel angle reads `ctx.timeMs` (hit-relative via the
 * bridge), so hogs start at angle 0 on the hit and restart on retrigger. The halo sparkle
 * decays on `ctx.dt` into per-voice `genState` (seeded RNG + sparkle buffer), which is
 * reset on (re)spawn → the sparkle replays from a fresh seed and never leaks across voices.
 */
export const sacredHogs: EffectGenerator<SacredHogsState> = {
  id: 'sacred-hogs',
  name: 'Sacred HOGs',
  category: 'wash',
  timebase: 'voice',
  paramSpec: [
    { key: 'hogHue', label: 'Hog Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'haloHue', label: 'Halo Hue', type: 'number', default: 30, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hogsPerHoop', label: 'Hogs / Hoop', type: 'number', default: 3, min: 1, max: 12, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 60, min: 0, max: 720, unit: '°/s' },
    { key: 'hogWidthDeg', label: 'Hog Width', type: 'number', default: 18, min: 2, max: 90, unit: '°' },
  ],
  createState(model: PixelModel): SacredHogsState {
    return { rng: mulberry32(SEED), sparkle: new Float32Array(model.pixelCount) };
  },
  render(ctx, params, fb, state) {
    const hogHue = pnum(params, 'hogHue', 200);
    const haloHue = pnum(params, 'haloHue', 30);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const hogsPerHoop = Math.max(1, Math.round(pnum(params, 'hogsPerHoop', 3)));
    const speed = pnum(params, 'speed', 60);
    const hogWidth = Math.max(1, pnum(params, 'hogWidthDeg', 18));

    // Halo sparkle: decay then re-seed a few twinkles on the top hoop of each drum.
    const decay = Math.exp(-ctx.dt / 250);
    for (let i = 0; i < state.sparkle.length; i++) state.sparkle[i]! *= decay;

    const angle = (ctx.timeMs / 1000) * speed; // degrees travelled by the hogs
    for (const drum of ctx.model.drums) {
      const topHoop = drum.hoopCount - 1;
      // Re-seed a couple of sparkles per drum each frame (deterministic via state.rng).
      const twinkles = 2;
      for (let k = 0; k < twinkles; k++) {
        const idx = drum.pixelStart + Math.floor(state.rng() * drum.pixelCount);
        if (idx >= drum.pixelStart && idx < drum.pixelStart + drum.pixelCount) {
          state.sparkle[idx] = Math.max(state.sparkle[idx]!, 0.6 + state.rng() * 0.4);
        }
      }

      for (let p = drum.pixelStart; p < drum.pixelStart + drum.pixelCount; p++) {
        const pix = ctx.model.pixels[p]!;
        if (pix.hoopIndex === topHoop) {
          // Top hoop = sparkling orange halo.
          const s = clamp01(state.sparkle[p]!);
          if (s < 0.004) continue;
          const v = clamp01(bri * s);
          const rgb = hsvToRgb(haloHue, sat, v);
          fb.max(p, rgb.r, rgb.g, rgb.b, v);
        } else {
          // Lower hoops carry circling hogs. Spread hogs evenly, offset per hoop.
          const hoopOffset = pix.hoopIndex * 37; // stagger hoops so they don't align
          let best = 0;
          for (let n = 0; n < hogsPerHoop; n++) {
            const hogAngle = angle + hoopOffset + (360 * n) / hogsPerHoop;
            const d = angularDist(pix.angleDeg, hogAngle);
            if (d < hogWidth) best = Math.max(best, 1 - d / hogWidth);
          }
          if (best < 0.004) continue;
          const v = clamp01(bri * best);
          const rgb = hsvToRgb(hogHue, sat, v);
          fb.max(p, rgb.r, rgb.g, rgb.b, v);
        }
      }
    }
  },
};
