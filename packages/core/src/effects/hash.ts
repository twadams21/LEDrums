/** Deterministic value noise for per-pixel, per-bucket effect decisions. */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Low-discrepancy sequence used for Sparkler's Random=0 ordered endpoint. */
export function ordered01(pixelId: number, bucket: number, seed: number): number {
  const phi = 0.6180339887498949;
  const seedOffset = hash01(seed, 0x6d2b79f5);
  const value = pixelId * phi + bucket * phi * 7 + seedOffset;
  return value - Math.floor(value);
}
