import { mulberry32At } from '../math';

/**
 * Order-independent random access for fire effects.
 *
 * The coordinate mix only chooses a position in the seeded Mulberry32 stream; the returned
 * value is still produced by the project's canonical PRNG. Keeping this seam named and pure
 * lets a pixel loop be reordered without changing its decisions, with no per-pixel generator
 * object allocation.
 */
export function fireRandom01(seed: number, coordinate: number, period: number, stream = 0): number {
  const index = Math.imul(coordinate | 0, 0x9e3779b9)
    ^ Math.imul(period | 0, 0x85ebca6b)
    ^ Math.imul(stream | 0, 0xc2b2ae35);
  return mulberry32At(seed, index);
}
