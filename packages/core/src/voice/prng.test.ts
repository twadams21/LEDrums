import { describe, expect, it } from 'vitest';
import { Prng, deriveSeed } from './prng';

describe('Prng (mulberry32)', () => {
  it('is deterministic for a given seed', () => {
    const a = new Prng(12345);
    const b = new Prng(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces floats in [0, 1)', () => {
    const p = new Prng(1);
    for (let i = 0; i < 1000; i++) {
      const x = p.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('nextInt(n) stays in [0, n) and returns 0 for n<=0', () => {
    const p = new Prng(99);
    for (let i = 0; i < 1000; i++) {
      const x = p.nextInt(5);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
    }
    expect(p.nextInt(0)).toBe(0);
    expect(p.nextInt(-3)).toBe(0);
  });

  it('reseed restores the stream', () => {
    const p = new Prng(7);
    const first = [p.next(), p.next(), p.next()];
    p.reseed(7);
    expect([p.next(), p.next(), p.next()]).toEqual(first);
  });

  it('deriveSeed decorrelates counters and is stable', () => {
    expect(deriveSeed(42, 1)).toBe(deriveSeed(42, 1));
    expect(deriveSeed(42, 1)).not.toBe(deriveSeed(42, 2));
  });
});
