/**
 * View-side maths for the {@link CurveField} primitive — the px mapping, SVG paths, drag
 * clamping and hit overlay that turn a curve VALUE into something you can see and grab.
 * No DOM, no Svelte, no IO, so it unit-tests without jsdom and the view stays a thin
 * renderer over it.
 *
 * The VALUE and its evaluation live in `@ledrums/core` (`model/curve`), because the same
 * shape is persisted in the project (an effect node's `lifeEnvelope`, a drum's velocity
 * curve) and evaluated by the server engine and the sim alike — `core` may not import the
 * web app, so the maths cannot live here. Re-exported below so this module stays the one
 * import a consumer of the control needs; what remains local is view maths: pixels, paths,
 * gestures and the hit overlay.
 *
 * The shape is deliberately domain-agnostic: the same value drives a time-domain envelope
 * (x = time, y = level) and a transfer curve (x = input velocity, y = output velocity).
 * Consumers own the unit mapping; everything here is 0..1.
 */
import { clampCurve01, evalCurve, normalizeCurve, type CurvePoint, type CurveValue } from '@ledrums/core';

export {
  CURVE_PROFILE_OPTIONS,
  DEFAULT_CURVE,
  evalCurve,
  IDENTITY_CURVE,
  isIdentityCurve,
  normalizeCurve,
  profileHasStrength,
  shapeAt,
  type CurveProfile,
  type CurvePoint,
  type CurveProfileOption,
  type CurveValue,
} from '@ledrums/core';

/** NaN (the only value with no place on the axis) reads as 0; ±Infinity clamps. */
export const clamp01 = clampCurve01;

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

/** Keyboard nudge in normalised units; shift multiplies by {@link NUDGE_COARSE}. */
export const NUDGE = 0.01;
export const NUDGE_COARSE = 10;

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
