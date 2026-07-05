/**
 * Lenses (D5) — coordinate transforms as first-class DATA. A lens is a pure
 * `(u, v, t) → (u, v)` warp applied between sampler and elements, chainable and
 * ordered. The warp maps the SAMPLED point into element space, so a `polar` lens makes
 * stripes read as rings on the kit (the sampled point's angle/radius become the
 * element-space axes).
 *
 * `hyper4d` is the exception: it re-projects the pixel's WORLD position through a
 * rotating 4D hypervolume, so it is applied by the scene renderer against world space
 * (defined for the world-space samplers `cylinder`/`footprint` first) — `applyLens`
 * treats it as identity in (u,v) space.
 *
 * All fns write into a caller-owned `out` pair — zero allocation on the per-pixel path.
 */
import { DEG2RAD, type Vec3 } from '../math';
import type { Lens } from './types';

const TAU = Math.PI * 2;

function wrap01(x: number): number {
  const r = x % 1;
  return r < 0 ? r + 1 : r;
}

/** A mutable (u,v) pair the lens chain warps in place. */
export type UvPair = [number, number];

/** Apply ONE lens to a canvas point. Pure; writes the warped point back into `uv`.
    (`_t` is the chain's shared clock — reserved for time-driven lenses; the current set
    is static per point, animation coming from scene params + hyper4d's world path.) */
export function applyLens(lens: Lens, uv: UvPair, _t: number): void {
  const x = uv[0] - 0.5;
  const y = uv[1] - 0.5;
  switch (lens.kind) {
    case 'polar': {
      // xy → (angle, radius): u = angle 0..1 around the centre, v = radius (0 centre,
      // 1 at the mid-edge). Stripes along v become rings; along u, spokes.
      uv[0] = wrap01(Math.atan2(y, x) / TAU);
      uv[1] = Math.hypot(x, y) / 0.5;
      return;
    }
    case 'unpolar': {
      // the inverse: treat (u,v) as (angle, radius) and place the point back in xy.
      const a = uv[0] * TAU;
      const r = uv[1] * 0.5;
      uv[0] = 0.5 + r * Math.cos(a);
      uv[1] = 0.5 + r * Math.sin(a);
      return;
    }
    case 'log-polar': {
      // infinite-zoom tunnels: radius on a log axis (self-similar rings), angle wraps.
      const r = Math.max(Math.hypot(x, y), 1e-4);
      uv[0] = wrap01(Math.atan2(y, x) / TAU);
      uv[1] = Math.log(r / 0.5) * (lens.zoom || 1);
      return;
    }
    case 'kaleido': {
      // fold + mirror the angle into `sectors`; radius unchanged.
      const sectors = Math.max(1, Math.round(lens.sectors));
      const sector = TAU / sectors;
      const r = Math.hypot(x, y);
      let a = Math.atan2(y, x) + lens.spinDeg * DEG2RAD;
      a = ((a % sector) + sector) % sector;
      if (a > sector / 2) a = sector - a; // mirror half
      uv[0] = 0.5 + r * Math.cos(a);
      uv[1] = 0.5 + r * Math.sin(a);
      return;
    }
    case 'mobius': {
      // conformal swirl: w = z / (1 + (a + bi)·z) on centre-relative complex z.
      const cr = lens.a;
      const ci = lens.b;
      const dr = 1 + cr * x - ci * y;
      const di = cr * y + ci * x;
      const den = dr * dr + di * di || 1e-12;
      uv[0] = 0.5 + (x * dr + y * di) / den;
      uv[1] = 0.5 + (y * dr - x * di) / den;
      return;
    }
    case 'tile': {
      uv[0] = wrap01(uv[0] * Math.max(1, lens.cols));
      uv[1] = wrap01(uv[1] * Math.max(1, lens.rows));
      return;
    }
    case 'swirl': {
      // rotate by an amount that falls off linearly to zero at `radius`.
      const r = Math.hypot(x, y);
      const radius = lens.radius > 1e-6 ? lens.radius : 1e-6;
      const fall = Math.max(0, 1 - r / radius);
      if (fall <= 0) return;
      const a = lens.amount * fall;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      uv[0] = 0.5 + x * cosA - y * sinA;
      uv[1] = 0.5 + x * sinA + y * cosA;
      return;
    }
    case 'hyper4d':
      // world-space lens — handled by the scene renderer (see hyper4dUv); identity here.
      return;
  }
}

/** Apply a lens chain in order (D5: chainable, ordered). */
export function applyLensChain(lenses: readonly Lens[], uv: UvPair, t: number): void {
  for (const l of lenses) applyLens(l, uv, t);
}

/**
 * The `hyper4d` world-space path (D5): lift the pixel's world position (normalized to
 * the kit bounds' centred unit cube) to 4D with `w = sin(wSpeed·t)`-driven offset,
 * rotate in the XW/YW/ZW planes, perspective-project back to 3D, and land on the canvas
 * as a planar (x,z) footprint. On a static kit this reads as the drum surfaces flowing
 * through a rotating hypervolume — patterns crawl in a way no 3D motion produces.
 */
export function hyper4dUv(
  lens: Extract<Lens, { kind: 'hyper4d' }>,
  world: Vec3,
  center: Vec3,
  invHalf: number,
  t: number,
  out: UvPair,
): void {
  // normalized, centred world coords
  let x = (world.x - center.x) * invHalf;
  let y = (world.y - center.y) * invHalf;
  let z = (world.z - center.z) * invHalf;
  let w = Math.sin(t * lens.wSpeed);
  // static plane rotations (params in degrees), each mixing one axis with w —
  // written out longhand so the per-pixel path allocates nothing.
  let c = Math.cos(lens.rotXW * DEG2RAD);
  let s = Math.sin(lens.rotXW * DEG2RAD);
  let n = x * c - w * s;
  w = x * s + w * c;
  x = n;
  c = Math.cos(lens.rotYW * DEG2RAD);
  s = Math.sin(lens.rotYW * DEG2RAD);
  n = y * c - w * s;
  w = y * s + w * c;
  y = n;
  c = Math.cos(lens.rotZW * DEG2RAD);
  s = Math.sin(lens.rotZW * DEG2RAD);
  n = z * c - w * s;
  w = z * s + w * c;
  z = n;
  // perspective 4D→3D: scale by d/(d−w) with the eye at w=d
  const d = 2;
  const persp = d / Math.max(0.25, d - w);
  x *= persp;
  z *= persp;
  // land on the canvas as a footprint-style plane
  out[0] = 0.5 + x * 0.5;
  out[1] = 0.5 + z * 0.5;
}
