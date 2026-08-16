/* Pure drag→value logic for the compact numeric face field (S5), extracted so the rule is
   unit-testable without a DOM — the same split `wheel-step.ts` makes for the wheel rule.

   The rule: a horizontal drag traverses the param's RANGE, not a fixed number of steps.
   A 0..1 depth and a 0..255 brightness must both feel like "drag across the field and you
   sweep the param", so the sensitivity is derived from (max - min) over a reference travel
   rather than from `step`. A param with no declared range has no travel to normalize
   against, so it falls back to one step per few pixels.

   Holding Shift is the fine modifier (quarter speed) — the convention every DAW numeric
   field uses, and the only way to hit 0.01 on a 0..1 param inside 220px. */

export interface DragNumberOptions {
  /** Value at pointer-down — the gesture's anchor, so a drag is never cumulative-rounded. */
  start: number;
  /** Horizontal pointer travel since pointer-down, in CSS px (right = increase). */
  dx: number;
  min?: number;
  max?: number;
  /** Declared step; the result is snapped to it. Defaults to 1. */
  step?: number;
  /** Fine modifier (Shift) — quarter sensitivity. */
  fine?: boolean;
}

/** Pixels of travel that sweep a ranged param end to end. Roughly a node card's width, so
    the gesture reads as "drag across the row". */
export const DRAG_TRAVEL_PX = 220;
/** Pixels per step for a param with no declared range (nothing to normalize against). */
export const DRAG_UNRANGED_PX_PER_STEP = 4;

/** Decimal places implied by `step`, so a snapped value never surfaces float noise. */
function places(step: number): number {
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
  return text.includes('.') ? text.split('.')[1]?.length ?? 0 : 0;
}

/**
 * The value a drag of `dx` px from `start` produces — snapped to `step` and clamped to
 * `[min, max]`. Pure: the caller keeps the anchor and re-evaluates on every pointermove,
 * so the gesture is idempotent (returning to dx=0 returns the starting value exactly).
 */
export function dragNumber(o: DragNumberOptions): number {
  const step = o.step && o.step > 0 ? o.step : 1;
  const ranged = o.min !== undefined && o.max !== undefined && o.max > o.min;
  const perPx = ranged
    ? (o.max! - o.min!) / DRAG_TRAVEL_PX
    : step / DRAG_UNRANGED_PX_PER_STEP;
  const delta = o.dx * perPx * (o.fine ? 0.25 : 1);

  const base = Number.isFinite(o.start) ? o.start : o.min ?? 0;
  const raw = base + delta;
  // Snap to the step lattice anchored at `min` (a 0.5-stepped 1..10 param must land on
  // 1.5, not on 1.0 + n×0.5 measured from zero).
  const anchor = o.min ?? 0;
  const snapped = anchor + Math.round((raw - anchor) / step) * step;

  let out = Number(snapped.toFixed(places(step) + 2));
  if (o.min !== undefined && out < o.min) out = o.min;
  if (o.max !== undefined && out > o.max) out = o.max;
  return out;
}
