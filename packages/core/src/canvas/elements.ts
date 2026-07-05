/**
 * Canvas element renderers (D4) — one tiny PURE function per element kind:
 * `(u, v, tSec, el) → [r, g, b, coverage] | null`. Coverage is the element's own
 * feathered alpha; `null` means the element doesn't touch this point at all. Scene
 * evaluation composites elements in painter's order with plain alpha-over
 * ({@link sceneColorAt}). No state, no RNG — everything derives from (u, v, t, el).
 */
import { clamp01, DEG2RAD } from '../math';
import { hsvToRgb } from '../color/color';
import type { CanvasElement, GradientStop } from './types';

/** rgb + coverage, all in [0,1]. */
export type ElementSample = readonly [number, number, number, number];

/** Hermite smoothstep; degenerate edges (e0 >= e1) collapse to a hard step at e1. */
function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 >= e1) return x < e1 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** positive modulo into [0, m). */
function wrap(x: number, m: number): number {
  const r = x % m;
  return r < 0 ? r + m : r;
}

// --- deterministic value noise (closed-form hash, no RNG state) ---

function hash2(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const ux = fade(fx);
  const uy = fade(fy);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/** Fractal value noise, `octaves` layers, normalized to [0,1]. */
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  const n = Math.max(1, Math.min(6, Math.round(octaves)));
  for (let o = 0; o < n; o++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return clamp01(sum / norm);
}

// --- per-kind renderers ---

function stripesAt(u: number, v: number, t: number, el: Extract<CanvasElement, { kind: 'stripes' }>): ElementSample | null {
  const a = el.angleDeg * DEG2RAD;
  const period = el.widthU > 1e-6 ? el.widthU : 1e-6;
  // position along the travel direction, drifting with time
  const s = (u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + t * el.speedUps;
  const phase = wrap(s / period, 1);
  const duty = clamp01(el.duty);
  if (duty <= 0) return null;
  // feather both edges of the lit band; softness is a fraction of the band width
  const soft = clamp01(el.softness) * duty * 0.5;
  const cov = smoothstep(0, soft, phase) * (1 - smoothstep(duty - soft, duty, phase));
  if (cov <= 0) return null;
  const c = hsvToRgb(el.hue, el.sat, 1);
  return [c.r, c.g, c.b, cov];
}

function circleAt(u: number, v: number, el: Extract<CanvasElement, { kind: 'circle' }>): ElementSample | null {
  const d = Math.hypot(u - el.cx, v - el.cy);
  const cov = 1 - smoothstep(el.r - el.feather, el.r, d);
  if (cov <= 0) return null;
  const c = hsvToRgb(el.hue, el.sat, 1);
  return [c.r, c.g, c.b, cov];
}

function gradientAt(u: number, v: number, el: Extract<CanvasElement, { kind: 'gradient' }>): ElementSample | null {
  const stops = el.stops;
  if (stops.length === 0) return null;
  const a = el.angleDeg * DEG2RAD;
  const at = clamp01((u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5);
  let lo: GradientStop = stops[0]!;
  let hi: GradientStop = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!;
    if (s.at <= at && s.at >= lo.at) lo = s;
    if (s.at >= at && s.at <= hi.at) hi = s;
  }
  const span = hi.at - lo.at;
  const f = span > 1e-6 ? clamp01((at - lo.at) / span) : 0;
  const c = hsvToRgb(lo.hue + (hi.hue - lo.hue) * f, lo.sat + (hi.sat - lo.sat) * f, lo.v + (hi.v - lo.v) * f);
  return [c.r, c.g, c.b, 1];
}

function polygonAt(u: number, v: number, el: Extract<CanvasElement, { kind: 'polygon' }>): ElementSample | null {
  const sides = Math.max(3, Math.round(el.sides));
  const du = u - el.cx;
  const dv = v - el.cy;
  const d = Math.hypot(du, dv);
  const sector = (Math.PI * 2) / sides;
  // fold the ray angle into one sector; the polygon edge distance along that ray
  const theta = Math.atan2(dv, du) - el.rotDeg * DEG2RAD;
  const local = wrap(theta, sector) - sector / 2;
  const rEdge = (el.r * Math.cos(Math.PI / sides)) / Math.cos(local);
  const cov = 1 - smoothstep(rEdge - el.feather, rEdge, d);
  if (cov <= 0) return null;
  const c = hsvToRgb(el.hue, el.sat, 1);
  return [c.r, c.g, c.b, cov];
}

function checkerAt(u: number, v: number, el: Extract<CanvasElement, { kind: 'checker' }>): ElementSample {
  const cols = Math.max(1, Math.round(el.cols));
  const rows = Math.max(1, Math.round(el.rows));
  const cu = Math.floor(wrap((u + el.phase) * cols, cols));
  const cv = Math.floor(wrap(v * rows, rows));
  const c = hsvToRgb((cu + cv) % 2 === 0 ? el.hueA : el.hueB, 1, 1);
  return [c.r, c.g, c.b, 1];
}

function noiseAt(u: number, v: number, t: number, el: Extract<CanvasElement, { kind: 'noise' }>): ElementSample {
  const n = fbm(u * el.scale + t * el.speed, v * el.scale, el.octaves);
  const c = hsvToRgb(el.hue, el.sat, n);
  return [c.r, c.g, c.b, 1];
}

/** Render one element at a canvas point — the pure per-kind dispatch. */
export function elementAt(u: number, v: number, t: number, el: CanvasElement): ElementSample | null {
  switch (el.kind) {
    case 'stripes':
      return stripesAt(u, v, t, el);
    case 'circle':
      return circleAt(u, v, el);
    case 'gradient':
      return gradientAt(u, v, el);
    case 'polygon':
      return polygonAt(u, v, el);
    case 'checker':
      return checkerAt(u, v, el);
    case 'noise':
      return noiseAt(u, v, t, el);
  }
}

/**
 * Composite a scene's elements at one canvas point, painter's order (later over
 * earlier) with plain alpha-over on the element's feathered coverage. Writes into
 * `out` (r,g,b at 0..2) and returns the accumulated coverage — 0 means fully
 * transparent (the sampled pixel stays untouched). `out` is a caller-owned scratch so
 * the per-pixel hot path allocates nothing.
 */
export function sceneColorAt(
  elements: readonly CanvasElement[],
  u: number,
  v: number,
  t: number,
  out: [number, number, number],
): number {
  let r = 0;
  let g = 0;
  let b = 0;
  let cov = 0;
  for (const el of elements) {
    const s = elementAt(u, v, t, el);
    if (!s) continue;
    const a = s[3];
    r = r * (1 - a) + s[0] * a;
    g = g * (1 - a) + s[1] * a;
    b = b * (1 - a) + s[2] * a;
    cov = cov * (1 - a) + a;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return cov;
}
