import type { Framebuffer } from '../../engine/framebuffer';
import type { DrumInfo, PixelModel } from '../../geometry/pixel-model';
import { hsvToRgb } from '../../color/color';
import { clamp01, type Vec3 } from '../../math';
import { createEmitterState, MAX_EMISSIONS, updateEmissions, type EmitterState } from '../emitter';
import { lifeFade } from '../life-fade';
import { pnum, type EffectGenerator } from '../types';
import { spatialWaveShell } from '../spatial-distortions';
import { createSpatialGeometry, fillSpatialGeometry, prepareSpatialGeometry, SPATIAL_COORDINATES, SPATIAL_DISTANCES, type SpatialGeometry } from '../spatial-geometry';
import { createSpatialSampling, sampleSpatialField, updateSpatialSampling, type SpatialSampling } from '../spatial-sampling';

export interface SpatialFieldState {
  em: EmitterState;
  geometry: SpatialGeometry;
  sampling: SpatialSampling;
  point: Vec3;
  /** Fixed-capacity frame scratch: ox, oy, oz, radius, strength, cached-distance flag. */
  waves: Float64Array;
  waveCount: number;
}

const WAVE_STRIDE = 6;
const noEmissionData = (): undefined => undefined;

/** Bounded fast path for neutral features and zero/one own-source wave. Keep the small
 * traversal separate from optional distortion and multi-source dispatch so neither sits
 * inside the common pixel loop. The shell/harmonic arithmetic is intentionally inlined:
 * routing every pixel through the general sampling helpers lost the distance-cache saving
 * in the matched benchmark. Keep this small specialization exact against sampleSpatialField
 * and the frozen legacy renderer (spatial-field-fast-path/contract tests). */
function renderNeutralField(
  model: PixelModel, fb: Framebuffer, state: SpatialFieldState, waveWidth: number,
  hue: number, sat: number, bri: number, hueSpread: number, updates: number,
): void {
  const normalized = state.geometry.normalized;
  const distances = state.geometry.distances;
  const { k, twist, phase } = state.sampling;
  const hasWave = state.waveCount === 1;
  const radius = state.waves[3]!, strength = state.waves[4]!;
  const coordinatesChanged = updates & SPATIAL_COORDINATES;
  const distancesChanged = updates & SPATIAL_DISTANCES;
  const centre = model.bounds.center, size = model.bounds.size;
  const invScale = 1 / (Number.isFinite(size) && size > 1 ? size * 0.5 : 1);
  const { ox, oy, oz } = state.geometry;
  for (let i = 0; i < model.pixels.length; i++) {
    const p = model.pixels[i]!;
    let nx: number, ny: number, nz: number;
    if (coordinatesChanged) {
      nx = (p.world.x - centre.x) * invScale;
      ny = (p.world.y - centre.y) * invScale;
      nz = (p.world.z - centre.z) * invScale;
      normalized[i * 3] = nx;
      normalized[i * 3 + 1] = ny;
      normalized[i * 3 + 2] = nz;
    } else {
      nx = normalized[i * 3]!;
      ny = normalized[i * 3 + 1]!;
      nz = normalized[i * 3 + 2]!;
    }
    // A single admitted wave has finite strength in [0,1]; the compact shell is also
    // in [0,1]. No multi-wave sum/clamp or cached-source flag is needed here.
    let ripple = 0;
    if (hasWave) {
      let d: number;
      if (distancesChanged) {
        const dx = p.world.x - ox, dy = p.world.y - oy, dz = p.world.z - oz;
        d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        distances[i] = d;
      } else d = distances[i]!;
      const x = (d - radius) / waveWidth;
      if (x > -1 && x < 1) {
        const g = 1 - x * x;
        ripple = g * g * strength;
      }
    }
    const ang = twist * nz + ripple * 1.2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const tx = nx * ca - ny * sa;
    const ty = nx * sa + ny * ca;
    const ph = phase + ripple * Math.PI;
    const f =
      Math.sin(k * tx + ph) * Math.cos(k * ty * 0.8 - ph * 0.7) +
      0.6 * Math.sin(k * (tx * 0.6 + ty * 0.5) + k * nz * 0.9 + ph * 1.3) +
      0.4 * Math.cos(k * nz * 1.7 - k * ty * 0.3 - ph * 0.5);
    const lum = Number.isFinite(f) ? clamp01((f + 2) * 0.25) : 0;
    const band = 0.06 + 0.94 * lum * lum;
    // Here lum/ripple/bri are finite and bounded: band >= 0.06, so only the inner
    // upper clamp can bind. Multiplying two [0,1] values needs no second clamp.
    const v = bri * Math.min(1, band + ripple * 0.7);
    if (v < 0.004) continue;
    const h = hue + (lum - 0.5) * hueSpread + ripple * 25;
    const rgb = hsvToRgb(Number.isFinite(h) ? h : 205, sat, v);
    fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
  }
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
 * Optional authored domain warp (swirl / radial ripple), bounded analytic advection, and a
 * fixed detail octave (harmonics / ridges) make the volume more intricate without a simulation.
 * Their amounts default to ZERO: existing shows retain the original field and hit response.
 * Parameter shapes/ranges are implementation choices, not separately user-locked requirements.
 *
 * Deterministic: ctx + engine-owned state, no RNG/clock/camera. O(pixels × live emissions),
 * with fixed harmonic/detail work; scratch is bounded and keyed to immutable model identity.
 * One cached source-distance table covers the ordinary voice's own hit. Other simultaneous
 * source drums use direct distance sampling, never an unbounded pixels×drums cache.
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
    { key: 'warp', label: 'Domain Warp', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'warpMode', label: 'Warp Mode', type: 'enum', default: 'swirl', options: ['swirl', 'ripple'] },
    { key: 'warpScale', label: 'Warp Scale', type: 'number', default: 2, min: 0.25, max: 6, step: 0.05, unit: '×kit' },
    { key: 'advection', label: 'Advection', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'detail', label: 'Detail', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'detailMode', label: 'Detail Mode', type: 'enum', default: 'harmonics', options: ['harmonics', 'ridges'] },
    { key: 'detailScale', label: 'Detail Scale', type: 'number', default: 3, min: 1, max: 8, step: 0.1, unit: '×field' },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.22, min: 0, max: 2, step: 0.01, unit: 'cyc/s' },
    { key: 'disturbance', label: 'Disturbance', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'waveSpeed', label: 'Wave Speed', type: 'number', default: 1100, min: 100, max: 5000, step: 10, unit: 'mm/s' },
    { key: 'waveWidth', label: 'Wave Width', type: 'number', default: 240, min: 20, max: 1000, step: 5, unit: 'mm' },
    { key: 'lifeMs', label: 'Wave Life', type: 'number', default: 1500, min: 100, max: 6000, step: 10, unit: 'ms' },
  ],
  createState(): SpatialFieldState {
    return {
      em: createEmitterState(), geometry: createSpatialGeometry(), sampling: createSpatialSampling(),
      point: { x: 0, y: 0, z: 0 }, waves: new Float64Array(MAX_EMISSIONS * WAVE_STRIDE), waveCount: 0,
    };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 205);
    const sat = clamp01(pnum(params, 'saturation', 0.85));
    const bri = clamp01(pnum(params, 'brightness', 1));
    const hueSpread = pnum(params, 'hueSpread', 70);
    const disturbance = clamp01(pnum(params, 'disturbance', 0.85));
    const waveSpeed = Math.max(1, pnum(params, 'waveSpeed', 1100));
    const waveWidth = Math.max(1, pnum(params, 'waveWidth', 240));
    const lifeMs = Math.max(1, pnum(params, 'lifeMs', 1500));

    const model = ctx.model;
    updateSpatialSampling(state.sampling, params, ctx.timeMs);

    // Hit-centred waves: resolve each live emission's origin once per frame. Unknown drums
    // (an unresolvable source, a thumbnail's synthetic id) simply contribute no wave.
    const live = updateEmissions(state.em, ctx, lifeMs, noEmissionData);
    const waves = state.waves;
    state.waveCount = 0;
    let source: DrumInfo | undefined;
    for (const em of live) {
      const drum = model.drumById.get(em.drumId);
      if (!drum) continue;
      const fade = lifeFade(ctx, clamp01(1 - em.ageMs / lifeMs));
      const strength = fade * clamp01(em.velocity) * disturbance;
      if (!Number.isFinite(strength) || strength < 0.002) continue;
      const o = drum.effectOriginWorld;
      if (state.waveCount === 0) source = drum;
      const j = state.waveCount++ * WAVE_STRIDE;
      waves[j] = o.x;
      waves[j + 1] = o.y;
      waves[j + 2] = o.z;
      waves[j + 3] = (waveSpeed * em.ageMs) / 1000;
      waves[j + 4] = strength;
      waves[j + 5] = em.drumId === source!.drumId ? 1 : 0;
    }
    const updates = prepareSpatialGeometry(state.geometry, model, source);

    const sampling = state.sampling;
    const neutral = sampling.warp === 0 && sampling.detail === 0 &&
      sampling.advectX === 0 && sampling.advectY === 0 && sampling.advectZ === 0;
    if (neutral && state.waveCount <= 1) {
      renderNeutralField(model, fb, state, waveWidth, hue, sat, bri, hueSpread, updates);
      return;
    }
    fillSpatialGeometry(state.geometry, updates);

    const normalized = state.geometry.normalized;
    const distances = state.geometry.distances;
    const waveEnd = state.waveCount * WAVE_STRIDE;
    for (let i = 0; i < model.pixels.length; i++) {
      const p = model.pixels[i]!;
      // Hit waves are evaluated at the actual physical position, not the warped domain:
      // changing detail/warp never moves the origin or the speed of a drum's hit wave.
      let ripple = 0;
      for (let j = 0; j < waveEnd; j += WAVE_STRIDE) {
        let d: number;
        if (waves[j + 5]) d = distances[i]!;
        else {
          const dx = p.world.x - waves[j]!;
          const dy = p.world.y - waves[j + 1]!;
          const dz = p.world.z - waves[j + 2]!;
          d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        ripple += spatialWaveShell(d, waves[j + 3]!, waveWidth) * waves[j + 4]!;
      }
      ripple = Number.isFinite(ripple) ? clamp01(ripple) : 0;
      const lum = sampleSpatialField(normalized[i * 3]!, normalized[i * 3 + 1]!, normalized[i * 3 + 2]!,
        ripple, sampling, state.point);
      // Sharpen into luminous bands with a soft floor so sparse hoops always read.
      const band = 0.06 + 0.94 * lum * lum;
      const v = clamp01(bri * clamp01(band + ripple * 0.7));
      if (v < 0.004) continue;
      const h = hue + (lum - 0.5) * hueSpread + ripple * 25;
      const rgb = hsvToRgb(Number.isFinite(h) ? h : 205, sat, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
