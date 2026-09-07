import { hsvToRgb } from '../../color/color';
import { clamp01, distance } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { lifeFade } from '../life-fade';
import { pnum, type EffectGenerator } from '../types';
import type { PixelModel } from '../../geometry/pixel-model';

export interface SpatialFieldState {
  em: EmitterState;
}

const TWO_PI = Math.PI * 2;

/**
 * Kit-relative normalisation: half the kit's largest extent, so world coordinates map to
 * roughly [-1, 1] about the bounds centre whatever the physical size. A degenerate (single
 * pixel / zero-size) kit falls back to 1 mm so the division stays finite.
 */
function kitScaleMm(model: PixelModel): number {
  const s = model.bounds.size;
  return Number.isFinite(s) && s > 1 ? s * 0.5 : 1;
}

/**
 * Spatial Field: one continuous, slowly twisting luminous field sampled at every pixel's
 * WORLD position, so the four drums read as windows onto a single volume of light rather
 * than four separate textures. The field is a bounded sum of a few sine/cosine harmonics
 * over kit-normalised XYZ, twisted about the vertical (Z-up) axis as a function of height,
 * and drifting on absolute time so it never phase-snaps on section recall.
 *
 * Each hit (this voice's own trigger under the voice engine; every live trigger under a
 * host with a trigger stream) launches an expanding spherical wave from the struck drum's
 * effect origin. Inside the wave's shell the field's phase is pushed and a luminous ridge
 * is added, so the ripple visibly distorts the pattern as it travels — not a global
 * brightness bump. Velocity scales the disturbance; the wave decays over `lifeMs`.
 *
 * Deterministic: pure function of ctx + emitter state, no RNG, no clock reads. O(pixels ×
 * (small fixed harmonic count + live emissions)); emissions are capped by the emitter.
 */
export const spatialField: EffectGenerator<SpatialFieldState> = {
  id: 'spatial-field',
  name: 'Spatial Field',
  category: 'texture',
  timebase: 'absolute',
  // A one-shot voice must outlive its own ripple: hard cutoff at `age >= lifeMs`.
  voiceLife: { key: 'lifeMs', unit: 'ms' },
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 205, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 70, min: 0, max: 360, unit: '°' },
    { key: 'scale', label: 'Scale', type: 'number', default: 1.4, min: 0.2, max: 6, step: 0.05, unit: '×kit' },
    { key: 'twist', label: 'Twist', type: 'number', default: 2.2, min: -8, max: 8, step: 0.1, unit: 'rad/kit' },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.22, min: 0, max: 2, step: 0.01, unit: 'cyc/s' },
    { key: 'disturbance', label: 'Disturbance', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'waveSpeed', label: 'Wave Speed', type: 'number', default: 1100, min: 100, max: 5000, step: 10, unit: 'mm/s' },
    { key: 'waveWidth', label: 'Wave Width', type: 'number', default: 240, min: 20, max: 1000, step: 5, unit: 'mm' },
    { key: 'lifeMs', label: 'Wave Life', type: 'number', default: 1500, min: 100, max: 6000, step: 10, unit: 'ms' },
  ],
  createState(): SpatialFieldState {
    return { em: createEmitterState() };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 205);
    const sat = clamp01(pnum(params, 'saturation', 0.85));
    const bri = clamp01(pnum(params, 'brightness', 1));
    const hueSpread = pnum(params, 'hueSpread', 70);
    const scale = Math.max(0.01, pnum(params, 'scale', 1.4));
    const twist = pnum(params, 'twist', 2.2);
    const speed = Math.max(0, pnum(params, 'speed', 0.22));
    const disturbance = clamp01(pnum(params, 'disturbance', 0.85));
    const waveSpeed = Math.max(1, pnum(params, 'waveSpeed', 1100));
    const waveWidth = Math.max(1, pnum(params, 'waveWidth', 240));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1500));

    const model = ctx.model;
    const centre = model.bounds.center;
    const invScale = 1 / kitScaleMm(model);
    const k = scale * Math.PI; // spatial frequency, radians per normalised kit unit
    const phase = TWO_PI * speed * (ctx.timeMs / 1000);

    // Hit-centred waves: resolve each live emission's origin once per frame. Unknown drums
    // (an unresolvable source, a thumbnail's synthetic id) simply contribute no wave.
    const live = updateEmissions(state.em, ctx, lifeMs, () => undefined);
    const waves: { ox: number; oy: number; oz: number; radius: number; strength: number }[] = [];
    for (const em of live) {
      const drum = model.drumById.get(em.drumId);
      if (!drum) continue;
      const fade = lifeFade(ctx, clamp01(1 - em.ageMs / lifeMs));
      const strength = fade * clamp01(em.velocity) * disturbance;
      if (strength < 0.002) continue;
      const o = drum.effectOriginWorld;
      waves.push({ ox: o.x, oy: o.y, oz: o.z, radius: (waveSpeed * em.ageMs) / 1000, strength });
    }

    for (const p of model.pixels) {
      const w = p.world;
      const nx = (w.x - centre.x) * invScale;
      const ny = (w.y - centre.y) * invScale;
      const nz = (w.z - centre.z) * invScale;

      // Wave contribution at this pixel: a smooth shell of finite width around each front.
      let ripple = 0;
      for (const wv of waves) {
        const dx = w.x - wv.ox;
        const dy = w.y - wv.oy;
        const dz = w.z - wv.oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const x = (d - wv.radius) / waveWidth;
        if (x <= -1 || x >= 1) continue;
        const g = 1 - x * x;
        ripple += g * g * wv.strength;
      }
      if (ripple > 1) ripple = 1;

      // Twist XY about Z as a function of height; the wave locally winds the twist further.
      const ang = twist * nz + ripple * 1.2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const tx = nx * ca - ny * sa;
      const ty = nx * sa + ny * ca;
      const ph = phase + ripple * Math.PI; // the front pushes the field's phase

      // Bounded harmonic sum, |f| <= 2.
      const f =
        Math.sin(k * tx + ph) * Math.cos(k * ty * 0.8 - ph * 0.7) +
        0.6 * Math.sin(k * (tx * 0.6 + ty * 0.5) + k * nz * 0.9 + ph * 1.3) +
        0.4 * Math.cos(k * nz * 1.7 - k * ty * 0.3 - ph * 0.5);
      const lum = clamp01((f + 2) * 0.25); // 0..1
      // Sharpen into luminous bands with a soft floor so sparse hoops always read.
      const band = 0.06 + 0.94 * lum * lum;
      const v = clamp01(bri * clamp01(band + ripple * 0.7));
      if (v < 0.004) continue;
      const rgb = hsvToRgb(hue + (lum - 0.5) * hueSpread + ripple * 25, sat, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
