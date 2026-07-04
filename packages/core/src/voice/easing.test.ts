import { describe, expect, it } from 'vitest';
import { ease } from './easing';
import type { EaseDir, EaseFn } from './types';

const FNS: EaseFn[] = ['linear', 'quad', 'cubic', 'quart', 'expo', 'sine', 'circ', 'back', 'bounce', 'elastic'];
const DIRS: EaseDir[] = ['in', 'out', 'inOut'];
/** Smooth, monotone-non-decreasing families (excludes overshoot/oscillating ones). */
const MONOTONE: EaseFn[] = ['linear', 'quad', 'cubic', 'quart', 'expo', 'sine', 'circ'];

// ---- endpoints + structural invariants (per fn × dir) -------------------------

describe('ease — endpoints and structure', () => {
  it('pins both endpoints exactly for every fn × dir', () => {
    for (const fn of FNS) {
      for (const dir of DIRS) {
        expect(ease({ fn, dir }, 0)).toBe(0);
        expect(ease({ fn, dir }, 1)).toBe(1);
      }
    }
  });

  it('crosses 0.5 at the midpoint for every inOut family', () => {
    for (const fn of FNS) expect(ease({ fn, dir: 'inOut' }, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('clamps phase outside 0..1 to the endpoints', () => {
    for (const fn of FNS) {
      for (const dir of DIRS) {
        expect(ease({ fn, dir }, -0.3)).toBe(0);
        expect(ease({ fn, dir }, 1.7)).toBe(1);
      }
    }
  });

  it('makes out the mirror of in: out(t) === 1 - in(1-t)', () => {
    for (const fn of FNS) {
      for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
        expect(ease({ fn, dir: 'out' }, t)).toBeCloseTo(1 - ease({ fn, dir: 'in' }, 1 - t), 15);
      }
    }
  });

  it('treats linear as direction-invariant (identity)', () => {
    for (const t of [0, 0.2, 0.37, 0.5, 0.83, 1]) {
      expect(ease({ fn: 'linear', dir: 'in' }, t)).toBe(t);
      expect(ease({ fn: 'linear', dir: 'out' }, t)).toBe(t);
      expect(ease({ fn: 'linear', dir: 'inOut' }, t)).toBe(t);
    }
  });
});

// ---- golden values (lock the math) -------------------------------------------

describe('ease — golden values', () => {
  it('reproduces known easeIn values at t=0.5', () => {
    expect(ease({ fn: 'quad', dir: 'in' }, 0.5)).toBeCloseTo(0.25, 15);
    expect(ease({ fn: 'cubic', dir: 'in' }, 0.5)).toBeCloseTo(0.125, 15);
    expect(ease({ fn: 'quart', dir: 'in' }, 0.5)).toBeCloseTo(0.0625, 15);
    expect(ease({ fn: 'expo', dir: 'in' }, 0.5)).toBeCloseTo(0.03125, 15);
    expect(ease({ fn: 'sine', dir: 'in' }, 0.5)).toBeCloseTo(1 - Math.SQRT1_2, 15);
    expect(ease({ fn: 'circ', dir: 'in' }, 0.5)).toBeCloseTo(1 - Math.sqrt(0.75), 15);
  });

  it('reproduces known easeOut values (mirror of easeIn)', () => {
    expect(ease({ fn: 'quad', dir: 'out' }, 0.5)).toBeCloseTo(0.75, 15);
    expect(ease({ fn: 'cubic', dir: 'out' }, 0.5)).toBeCloseTo(0.875, 15);
    expect(ease({ fn: 'quart', dir: 'out' }, 0.25)).toBeCloseTo(1 - Math.pow(0.75, 4), 15);
  });
});

// ---- shape properties --------------------------------------------------------

describe('ease — shape properties', () => {
  const sample = (fn: EaseFn, dir: EaseDir, n = 64): number[] =>
    Array.from({ length: n + 1 }, (_, i) => ease({ fn, dir }, i / n));

  it('is monotone non-decreasing for smooth families in every direction', () => {
    for (const fn of MONOTONE) {
      for (const dir of DIRS) {
        const xs = sample(fn, dir);
        for (let i = 1; i < xs.length; i++) {
          expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-12);
        }
      }
    }
  });

  it('overshoots the unit interval for back / elastic (by design)', () => {
    // easeIn dips below 0 near the start; easeOut exceeds 1 near the end.
    for (const fn of ['back', 'elastic'] as EaseFn[]) {
      const inXs = sample(fn, 'in');
      const outXs = sample(fn, 'out');
      expect(Math.min(...inXs)).toBeLessThan(0);
      expect(Math.max(...outXs)).toBeGreaterThan(1);
    }
  });
});
