import { clamp01, wrap } from '../math';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** Hue in degrees, [0, 360). */
  h: number;
  s: number;
  v: number;
}

/** HSV → RGB. Hue in degrees, s/v in [0,1]; returns r/g/b in [0,1]. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  h = wrap(h, 360);
  s = clamp01(s);
  v = clamp01(v);
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: r + m, g: g + m, b: b + m };
}

/** RGB → HSV. r/g/b in [0,1]; returns hue in degrees. */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  h = wrap(h, 360);
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** Parse a `#rrggbb` (or `#rgb`) hex string to normalized RGB. Falls back to black. */
export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

/** Quantize a normalized channel [0,1] to a 0..255 byte with optional gamma. */
export function toByte(v: number, gamma = 1): number {
  const x = clamp01(v);
  const g = gamma === 1 ? x : Math.pow(x, gamma);
  return Math.round(g * 255);
}
