import { describe, expect, it } from 'vitest';
import {
  CURVE_PROFILE_OPTIONS,
  DEFAULT_CURVE,
  NUDGE,
  STRENGTH_NOTCH,
  clamp01,
  clampBipolar,
  curveModeLabel,
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

const ALL: CurveProfile[] = ['bend', 'sCurve', 'snap'];
/** The fader's whole travel: below the notch, at it, and above it. */
const STRENGTHS = [-1, -0.5, 0, 0.5, 1];

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

  it('is exactly linear AT the notch for every bendable profile', () => {
    for (const profile of ['bend', 'sCurve'] as CurveProfile[]) {
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(shapeAt(profile, p, 0), `${profile}@${p}`).toBeCloseTo(p, 10);
      }
    }
  });

  it('leaves snap stepped whatever the strength', () => {
    for (const s of STRENGTHS) {
      expect(shapeAt('snap', 0.3, s)).toBe(0);
      expect(shapeAt('snap', 0.999, s)).toBe(0);
    }
  });

  it('bends bend harder as strength rises above the notch — ease-out', () => {
    // Ease-out: quick departure, slow settle — shaped value runs ABOVE linear.
    const mid = [0, 0.5, 1].map((s) => shapeAt('bend', 0.5, s));
    expect(mid[0]).toBeCloseTo(0.5, 10);
    expect(mid[1]).toBeGreaterThan(mid[0]!);
    expect(mid[2]).toBeGreaterThan(mid[1]!);
    expect(mid[2]).toBeLessThan(1);
  });

  it('bends bend the OTHER way below the notch — the log side', () => {
    const mid = [0, -0.5, -1].map((s) => shapeAt('bend', 0.5, s));
    expect(mid[0]).toBeCloseTo(0.5, 10);
    expect(mid[1]).toBeLessThan(mid[0]!);
    expect(mid[2]).toBeLessThan(mid[1]!);
    expect(mid[2]).toBeGreaterThan(0);
  });

  it('makes the two halves of the bend fader exact inverses of each other', () => {
    // f(+s) and f(−s) are inverse functions: f₋(f₊(u)) === u, everywhere.
    for (const s of [0.3, 0.6, 1]) {
      for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const there = shapeAt('bend', u, s);
        expect(shapeAt('bend', there, -s), `s=${s} u=${u}`).toBeCloseTo(u, 8);
      }
    }
  });

  it('steepens the sCurve shoulder above the notch, symmetric about the middle', () => {
    for (const s of STRENGTHS) {
      expect(shapeAt('sCurve', 0.5, s), `midpoint@${s}`).toBeCloseTo(0.5, 10);
      // Rotational symmetry: f(p) + f(1-p) === 1.
      expect(shapeAt('sCurve', 0.2, s) + shapeAt('sCurve', 0.8, s)).toBeCloseTo(1, 10);
    }
    // A stronger shoulder holds the early quarter lower.
    expect(shapeAt('sCurve', 0.25, 1)).toBeLessThan(shapeAt('sCurve', 0.25, 0.5));
    expect(shapeAt('sCurve', 0.25, 0.5)).toBeLessThan(shapeAt('sCurve', 0.25, 0));
  });

  it('inverts the sCurve below the notch — ease-out-in, crossing at centre', () => {
    // Over centre the early quarter runs ABOVE linear instead of below: fast off
    // the mark, a plateau through the middle, fast into the end.
    expect(shapeAt('sCurve', 0.25, -0.5)).toBeGreaterThan(0.25);
    expect(shapeAt('sCurve', 0.25, -1)).toBeGreaterThan(shapeAt('sCurve', 0.25, -0.5));
    // ...and it is the exact mirror of the un-inverted shape about the diagonal.
    for (const s of [0.4, 1]) {
      for (const u of [0.15, 0.35, 0.65, 0.85]) {
        expect(shapeAt('sCurve', shapeAt('sCurve', u, s), -s), `s=${s} u=${u}`).toBeCloseTo(u, 8);
      }
    }
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
    expect(shapeAt('bend', -1, 0.5)).toBe(0);
    expect(shapeAt('bend', 2, 0.5)).toBe(1);
  });
});

describe('evalCurve', () => {
  it('is flat outside the handles', () => {
    const v: CurveValue = { h0: { x: 0.25, y: 0.8 }, h1: { x: 0.75, y: 0.2 }, profile: 'bend', strength: 0 };
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

  it('interpolates linearly at the notch whatever the profile (bar snap)', () => {
    for (const profile of ['bend', 'sCurve'] as CurveProfile[]) {
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

  it('falls faster than linear early on above the notch — the decay shape', () => {
    const strong = fall('bend', 1);
    expect(evalCurve(strong, 0.25)).toBeLessThan(0.75);
    expect(evalCurve(strong, 0.5)).toBeLessThan(0.5);
    // ...and still has a tail rather than hitting zero early.
    expect(evalCurve(strong, 0.9)).toBeGreaterThan(0);
  });

  it('holds high then drops late below the notch — the log shape', () => {
    const log = fall('bend', -1);
    expect(evalCurve(log, 0.25)).toBeGreaterThan(0.75);
    expect(evalCurve(log, 0.5)).toBeGreaterThan(0.5);
    expect(evalCurve(log, 0.9)).toBeLessThan(evalCurve(log, 0.5));
  });

  it('lifts the quiet end on a rising transfer curve above the notch', () => {
    expect(evalCurve(rise('bend', 1), 0.25)).toBeGreaterThan(0.25);
    // ...and pushes it down below the notch — the opposite trade, one fader.
    expect(evalCurve(rise('bend', -1), 0.25)).toBeLessThan(0.25);
  });

  it('gates below h0.x on a rising transfer curve — the threshold case', () => {
    const gated: CurveValue = { h0: { x: 0.3, y: 0 }, h1: { x: 1, y: 1 }, profile: 'bend', strength: 0 };
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

describe('the notch', () => {
  it('sits at exact zero, where every bendable profile is dead straight', () => {
    // What the magnet snaps TO has to be an exactly-straight value, not a
    // nearly-straight one — the whole point of the detent.
    expect(shapeAt('bend', 0.37, 0)).toBe(0.37);
    expect(shapeAt('sCurve', 0.37, 0)).toBe(0.37);
  });

  it('is narrower than half the fader, and wider than the keyboard step', () => {
    // Wider than a nudge would mean a magnet the arrow keys cannot escape, which
    // is why the pull is pointer-only (Slider `notchSnap`); narrower than the
    // travel keeps the strong bends reachable.
    expect(STRENGTH_NOTCH).toBeGreaterThan(NUDGE);
    expect(STRENGTH_NOTCH).toBeLessThan(0.5);
  });

  it('leaves a shape just outside the zone visibly bent, so the snap is not hiding a cliff', () => {
    expect(shapeAt('bend', 0.5, STRENGTH_NOTCH)).toBeGreaterThan(0.5);
    expect(shapeAt('bend', 0.5, -STRENGTH_NOTCH)).toBeLessThan(0.5);
  });
});

describe('curveModeLabel', () => {
  it('names the bend continuum by which side of the notch the fader sits', () => {
    expect(curveModeLabel('bend', -0.6)).toBe('Log');
    expect(curveModeLabel('bend', 0)).toBe('Linear');
    expect(curveModeLabel('bend', 0.6)).toBe('Exp');
  });

  it('names the sCurve by its direction, inverted below the notch', () => {
    expect(curveModeLabel('sCurve', 0.6)).toBe('In-out');
    expect(curveModeLabel('sCurve', -0.6)).toBe('Out-in');
  });

  it('never calls a straight line a bend — the report that started this', () => {
    // A profile button that read "Exp" while drawing a straight line is exactly
    // what made the control look inert. The label is derived, so it cannot lie.
    expect(curveModeLabel('bend', 0)).toBe('Linear');
    expect(curveModeLabel('sCurve', 0)).toBe('Linear');
  });

  it('ignores strength entirely for snap', () => {
    expect(curveModeLabel('snap', 0)).toBe('Snap');
    expect(curveModeLabel('snap', 1)).toBe('Snap');
  });
});

describe('normalizeCurve', () => {
  it('clamps every field into range', () => {
    const v = normalizeCurve({
      h0: { x: -3, y: 9 },
      h1: { x: 4, y: -2 },
      profile: 'bend',
      strength: 5,
    });
    expect(v.h0).toEqual({ x: 0, y: 1 });
    expect(v.h1).toEqual({ x: 1, y: 0 });
    expect(v.strength).toBe(1);
  });

  it('keeps a negative strength rather than clamping it to zero', () => {
    expect(normalizeCurve({ ...DEFAULT_CURVE, strength: -0.4 }).strength).toBeCloseTo(-0.4, 10);
    expect(normalizeCurve({ ...DEFAULT_CURVE, strength: -9 }).strength).toBe(-1);
  });

  it('orders crossed handles by x so eval stays total', () => {
    const v = normalizeCurve({
      h0: { x: 0.8, y: 0.1 },
      h1: { x: 0.2, y: 0.9 },
      profile: 'bend',
      strength: 0,
    });
    expect(v.h0).toEqual({ x: 0.2, y: 0.9 });
    expect(v.h1).toEqual({ x: 0.8, y: 0.1 });
  });

  it('falls back to bend on an unknown profile', () => {
    const v = normalizeCurve({ ...DEFAULT_CURVE, profile: 'wobble' as CurveProfile });
    expect(v.profile).toBe('bend');
  });

  it('replaces non-finite coordinates with 0 rather than propagating NaN', () => {
    const v = normalizeCurve({
      h0: { x: NaN, y: Infinity },
      h1: { x: 0.5, y: 0.5 },
      profile: 'bend',
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
    const base: CurveValue = { h0: { x: 0.3, y: 1 }, h1: { x: 0.6, y: 0 }, profile: 'bend', strength: 0 };
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

  it('carries a negative strength through untouched', () => {
    const base: CurveValue = { ...DEFAULT_CURVE, profile: 'sCurve', strength: -0.6 };
    expect(dragHandle(base, 'h1', 0.5, 0.2).strength).toBeCloseTo(-0.6, 10);
  });
});

describe('nudgeHandle', () => {
  it('steps one axis and leaves the other alone', () => {
    const base: CurveValue = { h0: { x: 0.3, y: 0.5 }, h1: { x: 0.8, y: 0 }, profile: 'bend', strength: 0 };
    expect(nudgeHandle(base, 'h0', 'x', 0.05).h0).toEqual({ x: 0.35, y: 0.5 });
    expect(nudgeHandle(base, 'h0', 'y', -0.1).h0.y).toBeCloseTo(0.4, 10);
    expect(nudgeHandle(base, 'h0', 'y', -0.1).h0.x).toBe(0.3);
  });

  it('honours the same crossing clamp as a drag', () => {
    const base: CurveValue = { h0: { x: 0.3, y: 1 }, h1: { x: 0.32, y: 0 }, profile: 'bend', strength: 0 };
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

  it('draws a visibly different path either side of the notch', () => {
    // The regression guard for "the curve does nothing": same handles, three
    // fader positions, three genuinely different paths.
    const at = (s: number) => curvePath(fall('bend', s), box, 24).line;
    expect(at(0.7)).not.toBe(at(0));
    expect(at(-0.7)).not.toBe(at(0));
    expect(at(0.7)).not.toBe(at(-0.7));
  });
});

describe('plotHits', () => {
  const v = fall('bend', 0);

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
  it('offers the bend continuum plus its two special cases', () => {
    expect(CURVE_PROFILE_OPTIONS.map((o) => o.value)).toEqual(['bend', 'sCurve', 'snap']);
  });

  it('marks strength meaningful only where the profile actually bends', () => {
    expect(profileHasStrength('bend')).toBe(true);
    expect(profileHasStrength('sCurve')).toBe(true);
    expect(profileHasStrength('snap')).toBe(false);
  });

  it('opens on a shape that is visibly bent, not a straight line wearing a label', () => {
    expect(profileHasStrength(DEFAULT_CURVE.profile)).toBe(true);
    expect(DEFAULT_CURVE.strength).not.toBe(0);
    expect(evalCurve(DEFAULT_CURVE, 0.5)).not.toBeCloseTo(0.5, 2);
  });
});

describe('clamps', () => {
  it('clamp01 clamps, and treats non-finite input as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(NaN)).toBe(0);
  });

  it('clampBipolar keeps the sign the strength axis depends on', () => {
    expect(clampBipolar(-2)).toBe(-1);
    expect(clampBipolar(-0.4)).toBe(-0.4);
    expect(clampBipolar(2)).toBe(1);
    expect(clampBipolar(NaN)).toBe(0);
  });
});
