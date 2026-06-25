/**
 * Mulberry32 — a tiny, fast, deterministic 32-bit PRNG. Pure: given the same seed
 * it produces the same sequence on every platform, so the render engine stays
 * replay-deterministic (no `Math.random` / `Date.now` anywhere in core).
 *
 * Usage: hold one `Prng` in engine state (seeded once at construction). Graph eval
 * (`random` / `chance` nodes) draws from it. Derive a fresh independent stream for a
 * given trigger from a monotonic seq counter via {@link deriveSeed}.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    // Coerce to a uint32 so the bit math below is well-defined.
    this.state = seed >>> 0;
  }

  /** Re-seed in place (e.g. on engine reset) — restores a reproducible stream. */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in [0, n). Returns 0 for n <= 0. */
  nextInt(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n) % n;
  }
}

/**
 * Mix a monotonic counter into a 32-bit seed (a single round of the mulberry32
 * avalanche). Use to derive a per-trigger stream that is stable for that trigger
 * but decorrelated from its neighbours.
 */
export function deriveSeed(base: number, counter: number): number {
  let t = ((base >>> 0) + Math.imul(counter | 0, 0x9e3779b1)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
