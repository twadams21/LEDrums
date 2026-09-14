import { clamp, clamp01, type Vec3 } from '../math';
import { pnum, pstr, type ResolvedParams } from './types';
import { spatialRipple, spatialSwirl } from './spatial-distortions';

/** Runtime sampling uniforms, not persisted authoring types. Refreshed by value each frame:
 * the generator bridge reuses ONE params object across voices and modulation ticks. */
export interface SpatialSampling {
  k: number;
  twist: number;
  phase: number;
  warp: number;
  warpMode: 'swirl' | 'ripple';
  warpFrequency: number;
  advectX: number;
  advectY: number;
  advectZ: number;
  detail: number;
  detailMode: 'harmonics' | 'ridges';
  detailFrequency: number;
}

export function createSpatialSampling(): SpatialSampling {
  return {
    k: 0, twist: 0, phase: 0, warp: 0, warpMode: 'swirl', warpFrequency: 0,
    advectX: 0, advectY: 0, advectZ: 0, detail: 0, detailMode: 'harmonics', detailFrequency: 0,
  };
}

export function updateSpatialSampling(out: SpatialSampling, params: ResolvedParams, timeMs: number): void {
  out.k = Math.max(0.01, pnum(params, 'scale', 1.4)) * Math.PI;
  out.twist = pnum(params, 'twist', 2.2);
  out.phase = Math.PI * 2 * Math.max(0, pnum(params, 'speed', 0.22)) * (timeMs / 1000);
  out.warp = clamp01(pnum(params, 'warp', 0));
  out.warpMode = pstr(params, 'warpMode', 'swirl') === 'ripple' ? 'ripple' : 'swirl';
  out.warpFrequency = clamp(pnum(params, 'warpScale', 2), 0.25, 6) * Math.PI;
  // Analytic, bounded domain travel rather than integrated velocity: deterministic even on
  // a seek/large dt. Each component is bounded by the authored amount; speed 0 freezes it.
  const advection = clamp01(pnum(params, 'advection', 0));
  out.advectX = advection ? advection * Math.sin(out.phase * 0.31) : 0;
  out.advectY = advection ? advection * 0.5 * (Math.cos(out.phase * 0.23) - 1) : 0;
  out.advectZ = advection ? advection * 0.5 * Math.sin(out.phase * 0.17) : 0;
  out.detail = clamp01(pnum(params, 'detail', 0));
  out.detailMode = pstr(params, 'detailMode', 'harmonics') === 'ridges' ? 'ridges' : 'harmonics';
  out.detailFrequency = out.k * clamp(pnum(params, 'detailScale', 3), 1, 8);
}

/** Pure point-sampling seam shared by the production renderer and comparison adapter.
 * XYZ are kit-normalised WORLD coordinates (not UV / camera / per-drum local coordinates).
 * `ripple` is the bounded hit-wave contribution at the *undistorted* physical LED position.
 * Returns field luminance in [0,1]; HSV palette/coverage and bus/Scope remain outside.
 * `scratch` is caller-owned, overwritten only when warp is active; never retained here.
 * No pixel/model traversal: suitable for comparing a future shader against this CPU kernel.
 */
export function sampleSpatialField(
  nx: number, ny: number, nz: number, ripple: number, s: Readonly<SpatialSampling>, scratch: Vec3,
): number {
  // Skip the optional path entirely at defaults: keep legacy operation order / Float32
  // output, including signed zero, rather than multiplying extra terms by zero.
  if (s.advectX || s.advectY || s.advectZ) {
    nx += s.advectX;
    ny += s.advectY;
    nz += s.advectZ;
  }
  if (s.warp > 0) {
    if (s.warpMode === 'ripple') spatialRipple(nx, ny, nz, s.warp, s.warpFrequency, s.phase, scratch);
    else spatialSwirl(nx, ny, nz, s.warp, s.warpFrequency, s.phase, scratch);
    nx = scratch.x;
    ny = scratch.y;
    nz = scratch.z;
  }

  const ang = s.twist * nz + ripple * 1.2;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const tx = nx * ca - ny * sa;
  const ty = nx * sa + ny * ca;
  const ph = s.phase + ripple * Math.PI;
  const k = s.k;
  const f =
    Math.sin(k * tx + ph) * Math.cos(k * ty * 0.8 - ph * 0.7) +
    0.6 * Math.sin(k * (tx * 0.6 + ty * 0.5) + k * nz * 0.9 + ph * 1.3) +
    0.4 * Math.cos(k * nz * 1.7 - k * ty * 0.3 - ph * 0.5);
  let lum = clamp01((f + 2) * 0.25);
  if (s.detail > 0) {
    // A fixed extra octave (no authored unbounded iteration count). Ridges fold that
    // octave into thin filaments; harmonics retains smooth cross-currents.
    const dk = s.detailFrequency;
    const a = Math.sin(dk * (tx * 0.8 + nz * 0.6) - ph * 1.1);
    const b = Math.cos(dk * (ty * 0.7 - nz * 0.5) + ph * 0.9);
    const detail = s.detailMode === 'ridges' ? (1 - Math.abs(a * b)) ** 3 : (a * b + 1) * 0.5;
    const mix = s.detail * 0.65;
    lum = lum * (1 - mix) + detail * mix;
  }
  // Bad external coordinates / arithmetic overflow must never poison a framebuffer. Valid
  // authored ranges take the exact path above; no floating-point approximation at defaults.
  return Number.isFinite(lum) ? clamp01(lum) : 0;
}
