/**
 * View-side maths for the {@link CurveField} primitive — the px mapping, SVG paths, drag
 * clamping and hit overlay that turn a curve VALUE into something you can see and grab.
 * No DOM, no Svelte, no IO, so it unit-tests without jsdom and the view stays a thin
 * renderer over it.
 *
 * The value itself — its type, its profiles, and how it evaluates — lives in
 * `@ledrums/core` (`curve/curve.ts`) and is re-exported below, unchanged, so this module
 * stays the one import the control and its consumers reach for. It had to move: a curve is
 * authored content now (an effect node's `lifeEnvelope`, S6b), and the server engine
 * evaluates the same shape this control draws. Two copies of `evalCurve` would be two
 * answers to "what is this voice's brightness right now".
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
 * `strength` is **bipolar, −1..+1, with 0 as the centre notch**: 0 is no
 * curvature at all (the profile is exactly a straight line there), and the two
 * directions are inverse bends of each other. That is the whole lin/exp/log
 * question folded into ONE continuum rather than three buttons (Trent,
 * 2026-08-17): pushing the fader up from centre bends `bend` exponentially,
 * pulling it down bends it logarithmically — the exact inverse shape — and the
 * mode word the view prints is DERIVED from where the fader sits (see
 * {@link curveModeLabel}), never stored beside it. A profile with nothing to
 * bend (`snap`) reports `hasStrength: false` and the view disables the fader
 * rather than hiding it.
 *
 * Why a notch and not three modes: a straight line reachable only by picking
 * "Linear" from a list, while a button labelled "Exp" also draws a straight
 * line at strength 0, is how the control read as broken — the label promised a
 * bend the value did not have. With the notch there is exactly one neutral
 * position, it is in the middle where a fader's neutral belongs, and every
 * departure from it visibly bends.
 */
export {
  CURVE_PROFILE_OPTIONS,
  DEFAULT_CURVE,
  clampBipolar,
  clampUnit as clamp01,
  evalCurve,
  normalizeCurve,
  profileHasStrength,
  shapeAt,
} from '@ledrums/core';
export type { CurveProfile, CurveProfileOption, CurvePoint, CurveValue } from '@ledrums/core';

import {
  clampBipolar,
  clampUnit as clamp01,
  evalCurve,
  normalizeCurve,
  type CurveProfile,
  type CurvePoint,
  type CurveValue,
} from '@ledrums/core';


/** Which of the two handles a gesture is addressing. */
export type CurveHandle = 'h0' | 'h1';

/**
 * How one axis reads to a human. The control's maths never sees these — they
 * only label the readout — which is exactly what keeps the primitive
 * domain-agnostic: `{ label: 'decay', format: u => `${Math.round(u * 4000)} ms` }`
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

/**
 * Half-width of the fader's magnetic zone around centre. Linear is the one
 * value an author returns to deliberately, and a bare fader makes hitting an
 * exact 0 a pixel hunt — so the notch pulls, rather than merely being marked.
 *
 * The pull is the {@link Slider}'s `notchSnap`, which applies it to POINTER
 * drags only: a keyboard or wheel step is already exact, and a magnet several
 * steps wide would trap the thumb on the notch with no way to step off it.
 */
export const STRENGTH_NOTCH = 0.05;

/**
 * The mode word for a (profile, strength) pair — DERIVED, never stored. This is
 * what keeps "which mode am I in" answerable from one control: the fader IS the
 * mode, and the label always tells the truth about the shape on screen (a
 * straight line never gets called "Exp").
 */
export function curveModeLabel(profile: CurveProfile, strength: number): string {
  const s = clampBipolar(strength);
  if (profile === 'snap') return 'Snap';
  if (s === 0) return 'Linear';
  if (profile === 'sCurve') return s > 0 ? 'In-out' : 'Out-in';
  return s > 0 ? 'Exp' : 'Log';
}

/** One-line description of what the fader is doing, for the control's tooltip. */
export function curveModeHint(profile: CurveProfile, strength: number): string {
  if (profile === 'snap') return 'Snap holds the start level, then steps — nothing to bend';
  const mode = curveModeLabel(profile, strength);
  if (mode === 'Linear') return 'Linear — the notch. Push up or pull down to bend';
  if (mode === 'Exp') return 'Exp — fast departure, long tail. Pull below centre for Log';
  if (mode === 'Log') return 'Log — slow departure, late fall. Push above centre for Exp';
  if (mode === 'In-out') return 'S-curve, ease-in-out. Pull below centre to invert it';
  return 'S-curve inverted, ease-out-in. Push above centre to un-invert it';
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
