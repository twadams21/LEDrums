import type { Vec3 } from '../math';

/** Analytic coordinate distortions, not a fluid solver. Inputs are finite kit-normalised
 * coordinates, amount and frequency; phase is supplied by the caller. No time integration,
 * random state, camera or allocation. `out` belongs to the caller and may be reused.
 */

/** Swirl around world Z, with a height-dependent rotating current. The displacement is
 * bounded by |amount|: r * |angle| <= r * |amount| / (1 + r) <= |amount|. */
export function spatialSwirl(
  x: number, y: number, z: number, amount: number, frequency: number, phase: number, out: Vec3,
): void {
  const radius = Math.sqrt(x * x + y * y);
  const angle = amount * Math.sin(frequency * z - phase * 0.45) / (1 + radius);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  out.x = x * ca - y * sa;
  out.y = x * sa + y * ca;
  out.z = z;
}

/** Travelling concentric shells about the kit centre. Signed radial displacement is
 * bounded by |amount|; the centre is stationary (no undefined direction / singularity). */
export function spatialRipple(
  x: number, y: number, z: number, amount: number, frequency: number, phase: number, out: Vec3,
): void {
  const radius = Math.sqrt(x * x + y * y + z * z);
  // sin(f*r) / r has a finite limit at the centre, but a moving phase does not. This
  // softened direction makes both displacement AND its limit zero at the centre.
  const gain = amount * Math.sin(frequency * radius - phase) / (1 + radius);
  out.x = x + x * gain;
  out.y = y + y * gain;
  out.z = z + z * gain;
}

/** Compact smooth hit-wave shell. Exactly the original Spatial Field profile; distance,
 * radius and width are world millimetres, unrelated to authored domain/detail scale. */
export function spatialWaveShell(distanceMm: number, radiusMm: number, widthMm: number): number {
  const x = (distanceMm - radiusMm) / widthMm;
  if (x <= -1 || x >= 1) return 0;
  const g = 1 - x * x;
  return g * g;
}
