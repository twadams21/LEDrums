/**
 * The two-handle curve VALUE and its evaluation — the pure maths behind the `CurveField`
 * control (S6a), lifted into core so the engine can read the same shape the UI draws.
 *
 * It lives here rather than in `apps/web` because a curve is now authored CONTENT: an
 * effect node's `lifeEnvelope` persists one, it crosses the wire inside the Show, and both
 * the server engine and the web sim have to evaluate it identically. Core purity holds —
 * no DOM, no IO, no clock.
 *
 * The value is normalised 0..1 in both axes and axis semantics belong to the consumer, so
 * the same shape serves a time→level envelope and a velocity in→out transfer curve.
 * Outside the handles the curve is FLAT (`x < h0.x → h0.y`, `x > h1.x → h1.y`) — that is
 * what makes a handle pair expressive enough on its own: a run out to `h0.x` is a hold on
 * an envelope and a threshold/gate on a transfer curve, with no third handle and no mode.
 *
 * `strength` is **bipolar, −1..+1, with 0 as the centre notch** (F4, Trent 2026-08-17): 0 is
 * no curvature at all — the profile is exactly a straight line there — and the two directions
 * are inverse bends of each other, because the exponent is `base ^ strength` and `±s` give
 * reciprocal exponents. That folds the whole lin/exp/log question into ONE continuum instead
 * of three modes; the mode WORD is derived from where the fader sits, never stored. Profiles
 * with nothing to bend (`snap`) report `hasStrength: false`.
 *
 * The view-side maths (px mapping, SVG paths, drag clamping, hit overlay) stays in
 * `apps/web/src/lib/ui/curve-field.ts`, which re-exports everything below so there is one
 * implementation of the shape and one of its geometry.
 */
import { z } from 'zod';

/**
 * The fixed profile set (Trent, 2026-08-17 — closed; new shapes need a verdict).
 *
 * `bend` is the lin/exp/log continuum: one profile, signed strength. `sCurve` and `snap` are
 * the two special cases a continuum cannot express — an S has a shoulder at each end, and a
 * step has no shape at all.
 */
export type CurveProfile = 'bend' | 'sCurve' | 'snap';

/** A handle position in normalised field space. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** The whole control's value — persisted by S6b (`lifeEnvelope`) and S8 (velocity curve). */
export interface CurveValue {
  h0: CurvePoint;
  h1: CurvePoint;
  profile: CurveProfile;
  /**
   * −1..+1 curvature of `profile`, 0 = straight. The sign picks the DIRECTION of the bend
   * (`bend`: + exponential, − logarithmic; `sCurve`: + ease-in-out, − ease-out-in) and the
   * magnitude picks how hard. Ignored where {@link profileHasStrength} is false.
   */
  strength: number;
}

export interface CurveProfileOption {
  value: CurveProfile;
  label: string;
  /** False → `strength` is meaningless; the view greys the control out. */
  hasStrength: boolean;
}

/** Single source for the picker's options and the strength control's enablement. */
export const CURVE_PROFILE_OPTIONS: readonly CurveProfileOption[] = [
  { value: 'bend', label: 'Bend', hasStrength: true },
  { value: 'sCurve', label: 'S-curve', hasStrength: true },
  { value: 'snap', label: 'Snap', hasStrength: false },
] as const;

/** Whether `strength` does anything for this profile. */
export function profileHasStrength(profile: CurveProfile): boolean {
  return CURVE_PROFILE_OPTIONS.find((o) => o.value === profile)?.hasStrength ?? false;
}

/** Opening value: full-range fall, gently exponential — the shape a decay wants. */
export const DEFAULT_CURVE: CurveValue = {
  h0: { x: 0, y: 1 },
  h1: { x: 1, y: 0 },
  profile: 'bend',
  strength: 0.5,
};

/** Hardest `bend`, as the exponent at `strength = ±1` (its reciprocal going down). */
const BEND_MAX_POWER = 8;
/** Hardest `sCurve` shoulder, as the exponent at `strength = ±1`. */
const S_MAX_POWER = 5;

/**
 * Clamp to the unit interval. Distinct from {@link import('../math').clamp01} in one way that
 * matters here: NaN (the only value with no place on the axis) reads as 0 rather than
 * propagating, so a hand-edited document can never make the curve evaluate to NaN and blank
 * a voice.
 */
export const clampUnit = (n: number): number => (Number.isNaN(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

/** The same clamp over the bipolar strength axis. */
export const clampBipolar = (n: number): number =>
  Number.isNaN(n) ? 0 : n < -1 ? -1 : n > 1 ? 1 : n;

function isProfile(p: unknown): p is CurveProfile {
  return CURVE_PROFILE_OPTIONS.some((o) => o.value === p);
}

/**
 * Clamp every field into range and put the handles in x order, so {@link evalCurve} is total
 * over any value — including one loaded from an older or hand-edited document. Dragging can't
 * cross the handles, so the swap only ever fires on malformed input.
 */
export function normalizeCurve(value: CurveValue): CurveValue {
  const a = { x: clampUnit(value.h0.x), y: clampUnit(value.h0.y) };
  const b = { x: clampUnit(value.h1.x), y: clampUnit(value.h1.y) };
  const swapped = a.x > b.x;
  return {
    h0: swapped ? b : a,
    h1: swapped ? a : b,
    profile: isProfile(value.profile) ? value.profile : 'bend',
    strength: clampBipolar(value.strength),
  };
}

/**
 * The profile's shaping function on the normalised span between the handles: `p` 0..1 in,
 * 0..1 out, always `f(0) = 0` and `f(1) = 1` so the curve meets both handles exactly whatever
 * the strength.
 *
 * Both bendable profiles take their exponent as `base ^ strength`, which is what makes the
 * fader's two halves exact mirrors of each other: `+s` and `−s` give reciprocal exponents, so
 * the shapes are inverse functions and the notch at `s = 0` is `base⁰ = 1`, i.e. dead
 * straight, by arithmetic rather than by a special case.
 *
 * - `bend` above centre is an ease-OUT — quick departure, slow settle: the `exp(−t/τ)` decay
 *   the app already paints, and on a transfer curve "lift the quiet hits". Below centre is its
 *   inverse, the logarithmic hold-then-fall.
 * - `sCurve` above centre is ease-in-out (a shoulder at each end); below centre inverts it to
 *   ease-out-in — fast off the mark, a plateau through the middle, fast into the end.
 */
export function shapeAt(profile: CurveProfile, p: number, strength: number): number {
  const u = clampUnit(p);
  const s = clampBipolar(strength);
  switch (profile) {
    case 'snap':
      // Held at the start level until the end handle, then a step. The caller handles the
      // endpoints, so anything short of 1 is still "before".
      return u >= 1 ? 1 : 0;
    case 'bend': {
      const k = Math.pow(BEND_MAX_POWER, s); // s=−1 → 1/8 (log), 0 → 1, +1 → 8 (exp)
      return 1 - Math.pow(1 - u, k);
    }
    case 'sCurve': {
      const k = Math.pow(S_MAX_POWER, s); // s=−1 → 1/5 (out-in), 0 → 1, +1 → 5 (in-out)
      return u < 0.5 ? 0.5 * Math.pow(u * 2, k) : 1 - 0.5 * Math.pow((1 - u) * 2, k);
    }
  }
}

/**
 * The curve's y at a given x. Flat outside the handles; the profile shapes the span between
 * them. Coincident handles are a pure step at that x — no divide by zero, because both
 * endpoint branches fire first.
 */
export function evalCurve(value: CurveValue, x: number): number {
  const v = normalizeCurve(value);
  const at = clampUnit(x);
  if (at <= v.h0.x) return v.h0.y;
  if (at >= v.h1.x) return v.h1.y;
  if (v.profile === 'snap') return v.h0.y;
  const span = v.h1.x - v.h0.x;
  const p = (at - v.h0.x) / span;
  return v.h0.y + (v.h1.y - v.h0.y) * shapeAt(v.profile, p, v.strength);
}

const curvePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/**
 * Shape validation for a persisted/received curve. `evalCurve` is total without it (see
 * {@link normalizeCurve}), so this is a content guard rather than a safety one: it keeps a
 * malformed `lifeEnvelope` out of the document instead of silently snapping it to something
 * the author never drew. Re-exported by `@ledrums/protocol` next to the other wire schemas.
 */
export const curveValueSchema = z.object({
  h0: curvePointSchema,
  h1: curvePointSchema,
  profile: z.enum(['bend', 'sCurve', 'snap']),
  strength: z.number().min(-1).max(1),
});
