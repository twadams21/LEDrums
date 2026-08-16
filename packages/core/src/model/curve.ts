/* =============================================================================
   CURVE — the shared two-handle curve value and its evaluation.

   The shape a `CurveField` edits (S6a) and the shape the model persists are the
   SAME shape, so it lives here rather than in the web app: `core` owns the
   schema and the maths, the primitive owns the gestures and the pixels. Without
   this seam a curve read off a project could only be evaluated by importing UI
   code, which `core` may never do.

   Domain-agnostic by construction: both axes are normalised 0..1 and the axis
   SEMANTICS belong to the consumer. The same value is a time -> level envelope
   in one place and an input -> output velocity transfer curve in another; the
   maths here cannot tell them apart, which is the point.

   Outside the handles the curve is FLAT (`x < h0.x -> h0.y`, `x > h1.x ->
   h1.y`) — what makes two handles expressive enough on their own: a run out to
   `h0.x` is a hold on an envelope and a threshold/gate on a transfer curve,
   with no third handle and no mode.

   Purity: schema + maths only. No engine state, no IO, no DOM.
   ============================================================================= */
import { z } from 'zod';

/** The fixed profile set (Trent, 2026-08-17 — closed; new shapes need a verdict). */
export const curveProfileSchema = z.enum(['linear', 'exp', 'sCurve', 'snap']);
export type CurveProfile = z.infer<typeof curveProfileSchema>;

/** A handle position in normalised field space. */
export const curvePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type CurvePoint = z.infer<typeof curvePointSchema>;

/**
 * The whole control's value: two handles, ONE profile for the span between
 * them, and that profile's curvature.
 */
export const curveValueSchema = z.object({
  h0: curvePointSchema,
  h1: curvePointSchema,
  profile: curveProfileSchema,
  /** 0..1 curvature of `profile`; ignored where {@link profileHasStrength} is false. */
  strength: z.number().min(0).max(1),
});
export type CurveValue = z.infer<typeof curveValueSchema>;

export interface CurveProfileOption {
  value: CurveProfile;
  label: string;
  /** False -> `strength` is meaningless; the view greys the control out. */
  hasStrength: boolean;
}

/** Single source for the picker's options and the strength control's enablement. */
export const CURVE_PROFILE_OPTIONS: readonly CurveProfileOption[] = [
  { value: 'linear', label: 'Linear', hasStrength: false },
  { value: 'exp', label: 'Exp', hasStrength: true },
  { value: 'sCurve', label: 'S-curve', hasStrength: true },
  { value: 'snap', label: 'Snap', hasStrength: false },
] as const;

/** Whether `strength` does anything for this profile. */
export function profileHasStrength(profile: CurveProfile): boolean {
  return CURVE_PROFILE_OPTIONS.find((o) => o.value === profile)?.hasStrength ?? false;
}

/**
 * NaN (the only value with no place on the axis) reads as 0; ±Infinity clamps.
 * Deliberately NOT `math.ts`'s `clamp01`, which passes NaN straight through —
 * a NaN loose in a drag gesture or a hand-edited document would poison a path.
 */
export const clampCurve01 = (n: number): number =>
  Number.isNaN(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;

/**
 * Clamp every field into range and put the handles in x order, so
 * {@link evalCurve} is total over any value — including one loaded from an
 * older or hand-edited document. Dragging can't cross the handles, so the swap
 * only ever fires on malformed input.
 */
export function normalizeCurve(value: CurveValue): CurveValue {
  const a = { x: clampCurve01(value.h0.x), y: clampCurve01(value.h0.y) };
  const b = { x: clampCurve01(value.h1.x), y: clampCurve01(value.h1.y) };
  const swapped = a.x > b.x;
  return {
    h0: swapped ? b : a,
    h1: swapped ? a : b,
    profile: isCurveProfile(value.profile) ? value.profile : 'linear',
    strength: clampCurve01(value.strength),
  };
}

function isCurveProfile(p: unknown): p is CurveProfile {
  return CURVE_PROFILE_OPTIONS.some((o) => o.value === p);
}

/** Opening value for a LIFE envelope: full-range fall, gently exponential — the shape a
    decay wants. (Contrast {@link IDENTITY_CURVE}, the pass-through a TRANSFER curve starts at.) */
export const DEFAULT_CURVE: CurveValue = {
  h0: { x: 0, y: 1 },
  h1: { x: 1, y: 0 },
  profile: 'exp',
  strength: 0.5,
};

/** S6a's original name for {@link clampCurve01} — kept so both curve consumers read naturally. */
export const clampUnit = clampCurve01;

/** Hardest `exp` bend, as the exponent at `strength = 1`. */
const EXP_MAX_POWER = 8;
/** Hardest `sCurve` shoulder, as the exponent at `strength = 1`. */
const S_MAX_POWER = 5;

/**
 * The profile's shaping function on the normalised span between the handles:
 * `p` 0..1 in, 0..1 out, always `f(0) = 0` and `f(1) = 1` so the curve meets
 * both handles exactly whatever the strength.
 *
 * `exp` is an ease-OUT — quick departure, slow settle. That is the
 * `exp(−t/τ)` decay the app already paints; on a transfer curve it reads as
 * "lift the quiet hits". The opposite bend is reachable without a second
 * profile by moving a handle.
 */
export function shapeAt(profile: CurveProfile, p: number, strength: number): number {
  const u = clampCurve01(p);
  const s = clampCurve01(strength);
  switch (profile) {
    case 'linear':
      return u;
    case 'snap':
      // Held at the start level until the end handle, then a step. The caller
      // handles the endpoints, so anything short of 1 is still "before".
      return u >= 1 ? 1 : 0;
    case 'exp': {
      const k = Math.pow(EXP_MAX_POWER, s); // s=0 → 1 (linear), s=1 → 8
      return 1 - Math.pow(1 - u, k);
    }
    case 'sCurve': {
      const k = 1 + s * (S_MAX_POWER - 1); // s=0 → 1 (linear), s=1 → 5
      return u < 0.5 ? 0.5 * Math.pow(u * 2, k) : 1 - 0.5 * Math.pow((1 - u) * 2, k);
    }
  }
}

/**
 * The curve's y at a given x. Flat outside the handles; the profile shapes the
 * span between them. Coincident handles are a pure step at that x — no divide
 * by zero, because both endpoint branches fire first.
 */
export function evalCurve(value: CurveValue, x: number): number {
  const v = normalizeCurve(value);
  const at = clampCurve01(x);
  if (at <= v.h0.x) return v.h0.y;
  if (at >= v.h1.x) return v.h1.y;
  if (v.profile === 'snap') return v.h0.y;
  const span = v.h1.x - v.h0.x;
  const p = (at - v.h0.x) / span;
  return v.h0.y + (v.h1.y - v.h0.y) * shapeAt(v.profile, p, v.strength);
}

/** The pass-through curve: out = in. The value an absent curve stands in for. */
export const IDENTITY_CURVE: CurveValue = {
  h0: { x: 0, y: 0 },
  h1: { x: 1, y: 1 },
  profile: 'linear',
  strength: 0,
};

/**
 * Whether this curve is the pass-through. Checked on the NORMALISED value and
 * by shape rather than by field equality, so `{linear, strength: 0.7}` — which
 * every profile collapses to at the endpoints — still counts: `strength` is
 * inert under `linear`, and storing a curve that changes nothing is noise.
 */
export function isIdentityCurve(value: CurveValue): boolean {
  const v = normalizeCurve(value);
  return (
    v.profile === 'linear' && v.h0.x === 0 && v.h0.y === 0 && v.h1.x === 1 && v.h1.y === 1
  );
}
