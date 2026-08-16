import { describe, expect, it } from 'vitest';
import {
  CURVE_PROFILE_OPTIONS,
  DEFAULT_CURVE,
  clamp01,
  curvePath,
  dragHandle,
  evalCurve,
  normalizeCurve,
  nudgeHandle,
  plotHits,
  profileHasStrength,
  pxToUnit,
  sampleCurve,
  shapeAt,
  xToPx,
  yToPx,
  type CurveProfile,
  type CurveValue,
} from './curve-field';

const ALL: CurveProfile[] = ['linear', 'exp', 'sCurve', 'snap'];
const STRENGTHS = [0, 0.5, 1];

/** A full-range fall (1 → 0), the shape a decay param opens with. */
const fall = (profile: CurveProfile, strength: number): CurveValue => ({
  h0: { x: 0, y: 1 },
  h1: { x: 1, y: 0 },
  profile,
  strength,
});

/** A full-range rise (0 → 1), the shape a transfer curve opens with. */
const rise = (profile: CurveProfile, strength: number): CurveValue => ({
  h0: { x: 0, y: 0 },
  h1: { x: 1, y: 1 },
  profile,
  strength,
});

describe('shapeAt', () => {
  it('pins both ends for every profile at every strength', () => {
    for (const profile of ALL) {
      for (const s of STRENGTHS) {
        expect(shapeAt(profile, 0, s), `${profile}@${s} start`).toBe(0);
        expect(shapeAt(profile, 1, s), `${profile}@${s} end`).toBe(1);
      }
    }
  });

  it('collapses every curvable profile to linear at strength 0', () => {
    for (const profile of ['exp', 'sCurve'] as CurveProfile[]) {
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(shapeAt(profile, p, 0), `${profile}@${p}`).toBeCloseTo(p, 10);
      }
    }
  });

  it('leaves linear straight and snap stepped whatever the strength', () => {
    for (const s of STRENGTHS) {
      expect(shapeAt('linear', 0.3, s)).toBeCloseTo(0.3, 10);
      expect(shapeAt('linear', 0.7, s)).toBeCloseTo(0.7, 10);
      expect(shapeAt('snap', 0.3, s)).toBe(0);
      expect(shapeAt('snap', 0.999, s)).toBe(0);
    }
  });

  it('bends exp harder as strength rises, always ease-out', () => {
    // Ease-out: quick departure, slow settle — shaped value runs ABOVE linear.
    const mid = STRENGTHS.map((s) => shapeAt('exp', 0.5, s));
    expect(mid[0]).toBeCloseTo(0.5, 10);
    expect(mid[1]).toBeGreaterThan(mid[0]!);
    expect(mid[2]).toBeGreaterThan(mid[1]!);
    expect(mid[2]).toBeLessThan(1);
  });

  it('steepens the sCurve shoulder as strength rises, symmetric about the middle', () => {
    for (const s of STRENGTHS) {
      expect(shapeAt('sCurve', 0.5, s), `midpoint@${s}`).toBeCloseTo(0.5, 10);
      // Rotational symmetry: f(p) + f(1-p) === 1.
      expect(shapeAt('sCurve', 0.2, s) + shapeAt('sCurve', 0.8, s)).toBeCloseTo(1, 10);
    }
    // A stronger shoulder holds the early quarter lower.
    expect(shapeAt('sCurve', 0.25, 1)).toBeLessThan(shapeAt('sCurve', 0.25, 0.5));
    expect(shapeAt('sCurve', 0.25, 0.5)).toBeLessThan(shapeAt('sCurve', 0.25, 0));
  });

  it('stays monotonic across the span for every profile and strength', () => {
    for (const profile of ALL) {
      for (const s of STRENGTHS) {
        let prev = -Infinity;
        for (let i = 0; i <= 40; i += 1) {
          const v = shapeAt(profile, i / 40, s);
          expect(v, `${profile}@${s} at ${i / 40}`).toBeGreaterThanOrEqual(prev);
          prev = v;
        }
      }
    }
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(shapeAt('exp', -1, 0.5)).toBe(0);
    expect(shapeAt('exp', 2, 0.5)).toBe(1);
  });
});

describe('evalCurve', () => {
  it('is flat outside the handles', () => {
    const v: CurveValue = { h0: { x: 0.25, y: 0.8 }, h1: { x: 0.75, y: 0.2 }, profile: 'linear', strength: 0 };
    expect(evalCurve(v, 0)).toBeCloseTo(0.8, 10);
    expect(evalCurve(v, 0.1)).toBeCloseTo(0.8, 10);
    expect(evalCurve(v, 0.25)).toBeCloseTo(0.8, 10);
    expect(evalCurve(v, 0.75)).toBeCloseTo(0.2, 10);
    expect(evalCurve(v, 0.9)).toBeCloseTo(0.2, 10);
    expect(evalCurve(v, 1)).toBeCloseTo(0.2, 10);
  });

  it('meets both handle levels exactly for every profile and strength', () => {
    for (const profile of ALL) {
      for (const s of STRENGTHS) {
        const v: CurveValue = { h0: { x: 0.2, y: 0.9 }, h1: { x: 0.8, y: 0.1 }, profile, strength: s };
        expect(evalCurve(v, 0.2), `${profile}@${s} h0`).toBeCloseTo(0.9, 10);
        expect(evalCurve(v, 0.8), `${profile}@${s} h1`).toBeCloseTo(0.1, 10);
      }
    }
  });

  it('interpolates linearly at strength 0 whatever the profile (bar snap)', () => {
    for (const profile of ['linear', 'exp', 'sCurve'] as CurveProfile[]) {
      expect(evalCurve(fall(profile, 0), 0.25), profile).toBeCloseTo(0.75, 10);
      expect(evalCurve(fall(profile, 0), 0.5), profile).toBeCloseTo(0.5, 10);
    }
  });

  it('holds the start level then steps, for snap', () => {
    const v: CurveValue = { h0: { x: 0.2, y: 1 }, h1: { x: 0.6, y: 0 }, profile: 'snap', strength: 1 };
    expect(evalCurve(v, 0)).toBe(1);
    expect(evalCurve(v, 0.59)).toBe(1);
    expect(evalCurve(v, 0.6)).toBe(0);
    expect(evalCurve(v, 1)).toBe(0);
  });

  it('falls faster than linear early on, for exp — the decay shape', () => {
    const strong = fall('exp', 1);
    expect(evalCurve(strong, 0.25)).toBeLessThan(0.75);
    expect(evalCurve(strong, 0.5)).toBeLessThan(0.5);
    // ...and still has a tail rather than hitting zero early.
    expect(evalCurve(strong, 0.9)).toBeGreaterThan(0);
  });

  it('lifts the quiet end on a rising transfer curve, for exp', () => {
    expect(evalCurve(rise('exp', 1), 0.25)).toBeGreaterThan(0.25);
  });

  it('gates below h0.x on a rising transfer curve — the threshold case', () => {
    const gated: CurveValue = { h0: { x: 0.3, y: 0 }, h1: { x: 1, y: 1 }, profile: 'linear', strength: 0 };
    expect(evalCurve(gated, 0.1)).toBe(0);
    expect(evalCurve(gated, 0.29)).toBe(0);
    expect(evalCurve(gated, 0.65)).toBeCloseTo(0.5, 10);
  });

  it('is a clean step when the handles share an x — no divide by zero', () => {
    for (const profile of ALL) {
      const v: CurveValue = { h0: { x: 0.5, y: 1 }, h1: { x: 0.5, y: 0 }, profile, strength: 0.7 };
      expect(evalCurve(v, 0.49), profile).toBe(1);
      expect(evalCurve(v, 0.5), profile).toBe(1);
      expect(evalCurve(v, 0.51), profile).toBe(0);
      expect(Number.isFinite(evalCurve(v, 0.5)), profile).toBe(true);
    }
  });

  it('stays inside 0..1 for every profile, strength and x', () => {
    for (const profile of ALL) {
      for (const s of STRENGTHS) {
        for (let i = 0; i <= 20; i += 1) {
          const y = evalCurve(fall(profile, s), i / 20);
          expect(y, `${profile}@${s}`).toBeGreaterThanOrEqual(0);
          expect(y, `${profile}@${s}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('normalizeCurve', () => {
  it('clamps every field into range', () => {
    const v = normalizeCurve({
      h0: { x: -3, y: 9 },
      h1: { x: 4, y: -2 },
      profile: 'exp',
      strength: 5,
    });
    expect(v.h0).toEqual({ x: 0, y: 1 });
    expect(v.h1).toEqual({ x: 1, y: 0 });
    expect(v.strength).toBe(1);
  });

  it('orders crossed handles by x so eval stays total', () => {
    const v = normalizeCurve({
      h0: { x: 0.8, y: 0.1 },
      h1: { x: 0.2, y: 0.9 },
      profile: 'linear',
      strength: 0,
    });
    expect(v.h0).toEqual({ x: 0.2, y: 0.9 });
    expect(v.h1).toEqual({ x: 0.8, y: 0.1 });
  });

  it('falls back to linear on an unknown profile', () => {
    const v = normalizeCurve({ ...DEFAULT_CURVE, profile: 'wobble' as CurveProfile });
    expect(v.profile).toBe('linear');
  });

  it('replaces non-finite coordinates with 0 rather than propagating NaN', () => {
    const v = normalizeCurve({
      h0: { x: NaN, y: Infinity },
      h1: { x: 0.5, y: 0.5 },
      profile: 'linear',
      strength: NaN,
    });
    expect(v.h0).toEqual({ x: 0, y: 1 });
    expect(v.strength).toBe(0);
  });
});

describe('dragHandle', () => {
  it('moves the addressed handle in both axes', () => {
    const v = dragHandle(DEFAULT_CURVE, 'h0', 0.3, 0.4);
    expect(v.h0).toEqual({ x: 0.3, y: 0.4 });
    expect(v.h1).toEqual(DEFAULT_CURVE.h1);
  });

  it('clamps rather than swaps when a handle is dragged past its partner', () => {
    const base: CurveValue = { h0: { x: 0.3, y: 1 }, h1: { x: 0.6, y: 0 }, profile: 'linear', strength: 0 };
    expect(dragHandle(base, 'h0', 0.95, 0.5).h0.x).toBe(0.6);
    expect(dragHandle(base, 'h1', 0.05, 0.5).h1.x).toBe(0.3);
  });

  it('clamps to the field and never mutates the input', () => {
    const base = { ...DEFAULT_CURVE, h0: { ...DEFAULT_CURVE.h0 } };
    const next = dragHandle(base, 'h0', -2, 3);
    expect(next.h0).toEqual({ x: 0, y: 1 });
    expect(base.h0).toEqual({ x: 0, y: 1 });
    expect(next).not.toBe(base);
  });
});

describe('nudgeHandle', () => {
  it('steps one axis and leaves the other alone', () => {
    const base: CurveValue = { h0: { x: 0.3, y: 0.5 }, h1: { x: 0.8, y: 0 }, profile: 'linear', strength: 0 };
    expect(nudgeHandle(base, 'h0', 'x', 0.05).h0).toEqual({ x: 0.35, y: 0.5 });
    expect(nudgeHandle(base, 'h0', 'y', -0.1).h0.y).toBeCloseTo(0.4, 10);
    expect(nudgeHandle(base, 'h0', 'y', -0.1).h0.x).toBe(0.3);
  });

  it('honours the same crossing clamp as a drag', () => {
    const base: CurveValue = { h0: { x: 0.3, y: 1 }, h1: { x: 0.32, y: 0 }, profile: 'linear', strength: 0 };
    expect(nudgeHandle(base, 'h0', 'x', 0.5).h0.x).toBe(0.32);
  });
});

describe('sampleCurve and curvePath', () => {
  const box = { width: 300, height: 120, pad: 10 };

  it('spans the field end to end', () => {
    const points = sampleCurve(DEFAULT_CURVE, 16);
    expect(points[0]!.x).toBe(0);
    expect(points.at(-1)!.x).toBe(1);
  });

  it('straddles the snap step with a coincident pair so the path does not ramp', () => {
    const v: CurveValue = { h0: { x: 0, y: 1 }, h1: { x: 0.5, y: 0 }, profile: 'snap', strength: 0 };
    const at = sampleCurve(v, 16).filter((p) => p.x === 0.5);
    expect(at).toHaveLength(2);
    expect(at.map((p) => p.y).sort()).toEqual([0, 1]);
  });

  it('maps unit space to px and back through the same box', () => {
    expect(xToPx(0, box)).toBe(10);
    expect(xToPx(1, box)).toBe(290);
    expect(yToPx(1, box)).toBe(10);
    expect(yToPx(0, box)).toBe(110);
    const round = pxToUnit(xToPx(0.4, box), yToPx(0.7, box), box);
    expect(round.x).toBeCloseTo(0.4, 10);
    expect(round.y).toBeCloseTo(0.7, 10);
  });

  it('emits a stroked line and a closed area that share the curve', () => {
    const { line, area } = curvePath(DEFAULT_CURVE, box, 8);
    expect(line.startsWith('M')).toBe(true);
    expect(line.includes('NaN')).toBe(false);
    expect(area.startsWith(line)).toBe(true);
    expect(area.endsWith('Z')).toBe(true);
  });
});

describe('plotHits', () => {
  const v = fall('linear', 0);

  it('reads y off the curve when the hit does not carry one', () => {
    const [hit] = plotHits(v, [{ x: 0.25, at: 1000 }], 1000, 500);
    expect(hit!.y).toBeCloseTo(0.75, 10);
    expect(hit!.fade).toBe(1);
  });

  it('keeps an explicit y instead of the curve reading', () => {
    const [hit] = plotHits(v, [{ x: 0.25, y: 0.1, at: 1000 }], 1000, 500);
    expect(hit!.y).toBe(0.1);
  });

  it('fades linearly with age and drops expired hits', () => {
    const hits = [
      { x: 0.1, at: 1000 }, // fresh
      { x: 0.2, at: 750 }, // half faded
      { x: 0.3, at: 400 }, // expired
    ];
    const out = plotHits(v, hits, 1000, 500);
    expect(out).toHaveLength(2);
    expect(out[0]!.fade).toBe(1);
    expect(out[1]!.fade).toBeCloseTo(0.5, 10);
  });

  it('ignores hits stamped in the future rather than over-brightening them', () => {
    expect(plotHits(v, [{ x: 0.5, at: 2000 }], 1000, 500)).toHaveLength(0);
  });

  it('clamps hit x into the field', () => {
    const [hit] = plotHits(v, [{ x: 3, at: 1000 }], 1000, 500);
    expect(hit!.x).toBe(1);
  });
});

describe('profile options', () => {
  it('offers exactly the four agreed profiles', () => {
    expect(CURVE_PROFILE_OPTIONS.map((o) => o.value)).toEqual(['linear', 'exp', 'sCurve', 'snap']);
  });

  it('marks strength meaningful only where the profile actually bends', () => {
    expect(profileHasStrength('exp')).toBe(true);
    expect(profileHasStrength('sCurve')).toBe(true);
    expect(profileHasStrength('linear')).toBe(false);
    expect(profileHasStrength('snap')).toBe(false);
  });
});

describe('clamp01', () => {
  it('clamps, and treats non-finite input as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(NaN)).toBe(0);
  });
});
