/** Shared, dependency-free math helpers used across geometry, color, and effects. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear inverse-lerp; returns the position of `v` within [a,b], clamped to [0,1]. */
export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return clamp01((v - a) / (b - a));
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Wrap a value into [0, mod). */
export function wrap(v: number, mod: number): number {
  return ((v % mod) + mod) % mod;
}

/**
 * Mulberry32 — a tiny, fast, seedable PRNG. Deterministic given a seed, which is
 * exactly what stateful effects (pixel-accum) need for replay determinism (R13).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit string hash (FNV-1a) — used to derive RNG seeds from clip ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// --- deterministic value noise (closed-form hash, no RNG state) ---
// One implementation for every render path: canvas elements (`noise` kind) and the
// perlin-clouds generator both scramble the same lattice, so a formula edit here moves
// both together instead of drifting one against the other.

/** Deterministic 2D hash → [0,1) using a closed-form sin scramble (no RNG state). */
export function hash2(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth Hermite fade for cleaner interpolation than raw bilinear. */
export function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise at (x,y); integer lattice hashed, {@link fade}-interpolated. */
export function valueNoise(x: number, y: number): number {
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

/** Fractal value noise, `octaves` layers (clamped to 1..6), normalized to [0,1]. */
export function fbm(x: number, y: number, octaves: number): number {
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
