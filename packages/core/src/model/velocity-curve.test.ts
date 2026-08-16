import { describe, expect, it } from 'vitest';
import { IDENTITY_CURVE, isIdentityCurve, type CurveValue } from './curve';
import { inputMapSchema, type InputMap } from './project-schema';
import {
  applyDrumVelocity,
  applyVelocityCurve,
  velocityCurveFor,
  withVelocityCurve,
} from './velocity-curve';

/** Lift the quiet hits: a full-range curve bent by `exp` (ease-out). */
const LIFT: CurveValue = { h0: { x: 0, y: 0 }, h1: { x: 1, y: 1 }, profile: 'exp', strength: 1 };
/** A gate: nothing until 0.5 of the way in, then a step to full. */
const GATE: CurveValue = { h0: { x: 0.5, y: 0 }, h1: { x: 1, y: 1 }, profile: 'snap', strength: 0 };

const mapWith = (curves: Record<string, CurveValue>): InputMap =>
  inputMapSchema.parse({ velocityCurves: curves });

describe('velocityCurves storage', () => {
  it('defaults to empty, so an existing project loads with today’s behaviour', () => {
    expect(inputMapSchema.parse({}).velocityCurves).toEqual({});
  });

  it('round-trips a curve through the schema', () => {
    expect(mapWith({ kick: LIFT }).velocityCurves.kick).toEqual(LIFT);
  });

  it('rejects a curve outside the normalised field', () => {
    const bad = { h0: { x: 0, y: 0 }, h1: { x: 2, y: 1 }, profile: 'linear', strength: 0 };
    expect(() => inputMapSchema.parse({ velocityCurves: { kick: bad } })).toThrow();
  });
});

describe('applyVelocityCurve', () => {
  it('is the identity when the drum has no curve', () => {
    for (const v of [0, 0.25, 0.5, 0.87, 1]) {
      expect(applyVelocityCurve(undefined, v)).toBe(v);
    }
  });

  it('is the identity for an identity-shaped curve', () => {
    expect(applyVelocityCurve(IDENTITY_CURVE, 0.42)).toBe(0.42);
  });

  it('applies the curve otherwise', () => {
    // `exp` at full strength lifts the middle hard: 0.5 in reads well above 0.5 out.
    const out = applyVelocityCurve(LIFT, 0.5);
    expect(out).toBeGreaterThan(0.9);
    expect(out).toBeLessThanOrEqual(1);
  });

  it('holds the endpoints whatever the shape', () => {
    expect(applyVelocityCurve(LIFT, 0)).toBe(0);
    expect(applyVelocityCurve(LIFT, 1)).toBe(1);
  });

  it('clamps a curved input into the field', () => {
    expect(applyVelocityCurve(LIFT, -3)).toBe(0);
    expect(applyVelocityCurve(LIFT, 9)).toBe(1);
    expect(applyVelocityCurve(LIFT, Number.NaN)).toBe(0);
  });

  it('leaves an uncurved value untouched rather than clamping it — absent is a no-op', () => {
    expect(applyVelocityCurve(undefined, 4)).toBe(4);
    expect(applyVelocityCurve(IDENTITY_CURVE, -1)).toBe(-1);
  });

  it('steps through a snap profile — flat below the gate, full above it', () => {
    expect(applyVelocityCurve(GATE, 0.2)).toBe(0);
    expect(applyVelocityCurve(GATE, 0.49)).toBe(0);
    expect(applyVelocityCurve(GATE, 0.75)).toBe(0);
    expect(applyVelocityCurve(GATE, 1)).toBe(1);
  });
});

describe('per-drum lookup', () => {
  const map = mapWith({ kick: LIFT });

  it('finds the drum’s own curve and nobody else’s', () => {
    expect(velocityCurveFor(map, 'kick')).toEqual(LIFT);
    expect(velocityCurveFor(map, 'snare')).toBeUndefined();
    expect(velocityCurveFor(map, undefined)).toBeUndefined();
  });

  it('shapes only the drum that carries a curve', () => {
    expect(applyDrumVelocity(map, 'kick', 0.5)).toBeGreaterThan(0.9);
    expect(applyDrumVelocity(map, 'snare', 0.5)).toBe(0.5);
    // An unclaimed input (no drum resolved) is never shaped.
    expect(applyDrumVelocity(map, undefined, 0.5)).toBe(0.5);
    expect(applyDrumVelocity(map, '', 0.5)).toBe(0.5);
  });
});

describe('withVelocityCurve', () => {
  it('writes a curve without touching the other drums', () => {
    const next = withVelocityCurve(mapWith({ snare: GATE }), 'kick', LIFT);
    expect(next.velocityCurves).toEqual({ snare: GATE, kick: LIFT });
  });

  it('does not mutate the map it was given', () => {
    const map = mapWith({ kick: LIFT });
    withVelocityCurve(map, 'snare', GATE);
    expect(map.velocityCurves).toEqual({ kick: LIFT });
  });

  it('deletes rather than stores an identity curve — absent and identity are one state', () => {
    const next = withVelocityCurve(mapWith({ kick: LIFT }), 'kick', IDENTITY_CURVE);
    expect(next.velocityCurves).toEqual({});
  });

  it('clears explicitly on null (the reset affordance)', () => {
    expect(withVelocityCurve(mapWith({ kick: LIFT }), 'kick', null).velocityCurves).toEqual({});
  });

  it('is a no-op — same object — when clearing a drum that has no curve', () => {
    const map = mapWith({ kick: LIFT });
    expect(withVelocityCurve(map, 'snare', null)).toBe(map);
  });
});

describe('isIdentityCurve', () => {
  it('counts a linear full-range curve however its inert strength reads', () => {
    expect(isIdentityCurve(IDENTITY_CURVE)).toBe(true);
    expect(isIdentityCurve({ ...IDENTITY_CURVE, strength: 0.7 })).toBe(true);
  });

  it('rejects anything that actually bends or moves a handle', () => {
    expect(isIdentityCurve(LIFT)).toBe(false);
    expect(isIdentityCurve(GATE)).toBe(false);
    expect(isIdentityCurve({ ...IDENTITY_CURVE, h1: { x: 1, y: 0.5 } })).toBe(false);
  });
});
