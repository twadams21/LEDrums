/**
 * Pure maths for the {@link CurveField} primitive — a two-handle curve over a
 * normalised 0..1 × 0..1 field. No DOM, no Svelte, no IO, so it unit-tests
 * without jsdom and the view stays a thin renderer over it.
 *
 * The shape is deliberately domain-agnostic: the same value drives a
 * time-domain envelope (x = time, y = level) and a transfer curve (x = input
 * velocity, y = output velocity). Consumers own the unit mapping; everything
 * here is 0..1.
 *
 * Outside the handles the curve is FLAT — `x < h0.x → h0.y`, `x > h1.x → h1.y`
 * — which is what makes a handle pair expressive enough on its own: dragging
 * `h0` right is a hold (envelope) or a threshold/gate (transfer curve) without
 * a third handle or a mode.
 *
 * `strength` is the curvature of the chosen profile, unipolar: **0 is no
 * curvature at all** (every profile collapses to `linear` there, exactly), 1 is
 * the hardest bend. Profiles with nothing to curve (`linear`, `snap`) report
 * `hasStrength: false` — the view disables the control rather than hiding it.
 */

/** The fixed profile set (Trent, 2026-08-17 — closed; new shapes need a verdict). */
export type CurveProfile = 'linear' | 'exp' | 'sCurve' | 'snap';

/** A handle position in normalised field space. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** The whole control's value. Exported for S6b (envelope life/decay) and S8
    (per-drum velocity sensitivity), which persist it in their own models. */
export interface CurveValue {
  h0: CurvePoint;
  h1: CurvePoint;
  profile: CurveProfile;
  /** 0..1 curvature of `profile`; ignored where `hasStrength` is false. */
  strength: number;
}

/** Which of the two handles a gesture is addressing. */
export type CurveHandle = 'h0' | 'h1';

/**
 * How one axis reads to a human. The control's maths never sees these — they
 * only label the readout — which is exactly what keeps the primitive
 * domain-agnostic: `{ label: 'life', format: u => `${Math.round(u * 4000)} ms` }`
 * for an envelope, `{ label: 'velocity' }` for a transfer curve.
 */
export interface CurveAxisSpec {
  label?: string;
  /** Normalised 0..1 → the consumer's units, already formatted. */
  format?: (u: number) => string;
}

export interface CurveProfileOption {
  value: CurveProfile;
  label: string;
  /** False → `strength` is meaningless; the view greys the control out. */
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

/** Opening value: full-range fall, gently exponential — the shape a decay wants. */
export const DEFAULT_CURVE: CurveValue = {
  h0: { x: 0, y: 1 },
  h1: { x: 1, y: 0 },
  profile: 'exp',
  strength: 0.5,
};

/** Keyboard nudge in normalised units; shift multiplies by {@link NUDGE_COARSE}. */
export const NUDGE = 0.01;
export const NUDGE_COARSE = 10;

/** Hardest `exp` bend, as the exponent at `strength = 1`. */
const EXP_MAX_POWER = 8;
/** Hardest `sCurve` shoulder, as the exponent at `strength = 1`. */
const S_MAX_POWER = 5;

/** NaN (the only value with no place on the axis) reads as 0; ±Infinity clamps. */
export const clamp01 = (n: number): number => (Number.isNaN(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Clamp every field into range and put the handles in x order, so `evalCurve`
 * is total over any value — including one loaded from an older/hand-edited
 * document. Dragging can't cross the handles (see {@link dragHandle}), so the
 * swap only ever fires on malformed input.
 */
export function normalizeCurve(value: CurveValue): CurveValue {
  const a = { x: clamp01(value.h0.x), y: clamp01(value.h0.y) };
  const b = { x: clamp01(value.h1.x), y: clamp01(value.h1.y) };
  const swapped = a.x > b.x;
  return {
    h0: swapped ? b : a,
    h1: swapped ? a : b,
    profile: isProfile(value.profile) ? value.profile : 'linear',
    strength: clamp01(value.strength),
  };
}

function isProfile(p: unknown): p is CurveProfile {
  return CURVE_PROFILE_OPTIONS.some((o) => o.value === p);
}

/**
 * The profile's shaping function on the normalised span between the handles:
 * `p` 0..1 in, 0..1 out, always `f(0) = 0` and `f(1) = 1` so the curve meets
 * both handles exactly whatever the strength.
 *
 * `exp` is an ease-OUT — quick departure, slow settle. That is the
 * `exp(−t/τ)` decay the app already paints (and the shape this control exists
 * to beat); on a transfer curve it reads as "lift the quiet hits". The
 * opposite bend is reachable without a second profile by moving a handle: a
 * flat run out to `h0.x` is a hold, or a gate.
 */
export function shapeAt(profile: CurveProfile, p: number, strength: number): number {
  const u = clamp01(p);
  const s = clamp01(strength);
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
  const at = clamp01(x);
  if (at <= v.h0.x) return v.h0.y;
  if (at >= v.h1.x) return v.h1.y;
  if (v.profile === 'snap') return v.h0.y;
  const span = v.h1.x - v.h0.x;
  const p = (at - v.h0.x) / span;
  return v.h0.y + (v.h1.y - v.h0.y) * shapeAt(v.profile, p, v.strength);
}

/** `samples + 1` evenly spaced points across the field, for plotting. */
export function sampleCurve(value: CurveValue, samples = 64): CurvePoint[] {
  const n = Math.max(2, Math.floor(samples));
  const v = normalizeCurve(value);
  const points: CurvePoint[] = [];
  for (let i = 0; i <= n; i += 1) {
    const x = i / n;
    points.push({ x, y: evalCurve(v, x) });
  }
  // `snap` is a discontinuity: without the pair of points straddling h1.x the
  // sampler draws a diagonal ramp through it and lies about the shape.
  if (v.profile === 'snap' && v.h1.x > 0 && v.h1.x < 1) {
    const cut = points.findIndex((p) => p.x >= v.h1.x);
    if (cut > 0) {
      // Drop a sample that already sits exactly on the step — it would be a
      // third, redundant point at the same x.
      const replace = points[cut]!.x === v.h1.x ? 1 : 0;
      points.splice(cut, replace, { x: v.h1.x, y: v.h0.y }, { x: v.h1.x, y: v.h1.y });
    }
  }
  return points;
}

/** The plot box a path is drawn into: a px-true viewBox plus inner padding. */
export interface CurveBox {
  width: number;
  height: number;
  pad: number;
}

/** normalised x → viewBox px. */
export const xToPx = (x: number, box: CurveBox): number =>
  box.pad + clamp01(x) * Math.max(0, box.width - box.pad * 2);
/** normalised y → viewBox px (inverted: y=0 at the bottom). */
export const yToPx = (y: number, box: CurveBox): number =>
  box.pad + (1 - clamp01(y)) * Math.max(0, box.height - box.pad * 2);

/** viewBox px → normalised, the inverse of {@link xToPx} / {@link yToPx}. */
export function pxToUnit(px: number, py: number, box: CurveBox): CurvePoint {
  const iw = Math.max(1, box.width - box.pad * 2);
  const ih = Math.max(1, box.height - box.pad * 2);
  return { x: clamp01((px - box.pad) / iw), y: clamp01(1 - (py - box.pad) / ih) };
}

/** The stroked curve and the filled area under it, as SVG path data. */
export function curvePath(
  value: CurveValue,
  box: CurveBox,
  samples = 64,
): { line: string; area: string } {
  const points = sampleCurve(value, samples);
  let line = '';
  for (const [i, p] of points.entries()) {
    line += `${i === 0 ? 'M' : 'L'}${xToPx(p.x, box).toFixed(2)} ${yToPx(p.y, box).toFixed(2)}`;
  }
  const floor = yToPx(0, box).toFixed(2);
  const area = `${line}L${xToPx(1, box).toFixed(2)} ${floor}L${xToPx(0, box).toFixed(2)} ${floor}Z`;
  return { line, area };
}

/**
 * A handle drag → the next value. Handles clamp against each other in x rather
 * than swapping: a handle that can cross its partner makes "which one am I
 * holding" unanswerable mid-gesture. Both handles are free in y.
 */
export function dragHandle(
  value: CurveValue,
  handle: CurveHandle,
  x: number,
  y: number,
): CurveValue {
  const v = normalizeCurve(value);
  const nx = clamp01(x);
  const ny = clamp01(y);
  return handle === 'h0'
    ? { ...v, h0: { x: Math.min(nx, v.h1.x), y: ny } }
    : { ...v, h1: { x: Math.max(nx, v.h0.x), y: ny } };
}

/** Keyboard/wheel nudge of one handle along one axis, in normalised units. */
export function nudgeHandle(
  value: CurveValue,
  handle: CurveHandle,
  axis: 'x' | 'y',
  delta: number,
): CurveValue {
  const v = normalizeCurve(value);
  const point = v[handle];
  const next = axis === 'x' ? { x: point.x + delta, y: point.y } : { x: point.x, y: point.y + delta };
  return dragHandle(v, handle, next.x, next.y);
}

/** A recent input event for the live overlay: `y` omitted → read off the curve. */
export interface CurveHit {
  x: number;
  y?: number;
  /** `performance.now()`-style timestamp, for the fade. */
  at: number;
}

/** A hit resolved onto the curve, with its 0..1 fade (1 = fresh, 0 = expired). */
export interface PlottedHit extends CurvePoint {
  at: number;
  fade: number;
}

/**
 * Resolve the overlay's hits against the curve at a given clock, dropping the
 * expired ones. Pure so the fade is testable without a rAF loop, and so the
 * overlay can never write back into the value it is drawn over.
 */
export function plotHits(
  value: CurveValue,
  hits: readonly CurveHit[],
  now: number,
  fadeMs: number,
): PlottedHit[] {
  const span = Math.max(1, fadeMs);
  const out: PlottedHit[] = [];
  for (const hit of hits) {
    const age = now - hit.at;
    if (age < 0 || age > span) continue;
    out.push({
      x: clamp01(hit.x),
      y: hit.y === undefined ? evalCurve(value, hit.x) : clamp01(hit.y),
      at: hit.at,
      fade: 1 - age / span,
    });
  }
  return out;
}
