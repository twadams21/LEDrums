import { clamp01 } from '../math';

export const BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'lighten', 'max'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Blend a single source channel over a dest channel (both [0,1]), before opacity mix. */
export function blendChannel(mode: BlendMode, d: number, s: number): number {
  switch (mode) {
    case 'normal':
      return s;
    case 'add':
      return clamp01(d + s);
    case 'screen':
      return 1 - (1 - d) * (1 - s);
    case 'multiply':
      return d * s;
    case 'lighten':
    case 'max':
      return Math.max(d, s);
  }
}

/**
 * Composite a source RGBA over a dest RGB using a blend mode + layer opacity.
 * `a = opacity * srcAlpha` controls how much of the blended result mixes in, so
 * `normal` with a=1 replaces, a=0 leaves dest untouched, and `add` scales by opacity.
 * Mutates `dst` in place at the given base index (stride 4 = RGBA).
 */
export function compositeInto(
  dst: Float32Array,
  di: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  mode: BlendMode,
  opacity: number,
): void {
  const a = clamp01(opacity) * clamp01(sa);
  if (a === 0) return;
  const dr = dst[di]!;
  const dg = dst[di + 1]!;
  const db = dst[di + 2]!;
  dst[di] = clamp01(dr + (blendChannel(mode, dr, sr) - dr) * a);
  dst[di + 1] = clamp01(dg + (blendChannel(mode, dg, sg) - dg) * a);
  dst[di + 2] = clamp01(db + (blendChannel(mode, db, sb) - db) * a);
  // Dest alpha accumulates coverage so stacked layers report opacity correctly.
  dst[di + 3] = clamp01(dst[di + 3]! + a * (1 - dst[di + 3]!));
}
