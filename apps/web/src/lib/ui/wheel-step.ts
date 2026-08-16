/* Pure wheel→value logic for the numeric primitives (CommitInput type=number, Slider),
   extracted so the rule is unit-testable without a DOM.

   The rule (Trent, 2026-08-13): hovering a numeric control and scrolling adjusts it by ONE
   step per wheel tick — not by the wheel's pixel delta. Browsers report a tick as ~100px
   (deltaMode 0), 3 lines (mode 1) or a page (mode 2), and a trackpad reports a stream of
   small deltas; taking the magnitude would make the same gesture mean different things on
   different hardware. Only the SIGN is read: up increases, down decreases. */

export interface WheelStepOptions {
  /** The control's current value — '' / non-numeric means "no value yet". */
  value: string | number;
  /** `WheelEvent.deltaY`; only its sign is used. */
  deltaY: number;
  min?: number;
  max?: number;
  /** Value moved per tick. Defaults to 1 — "one integer per tick". */
  step?: number;
}

/** Decimal places of `step`, so 0.1 + 0.2 never surfaces as 0.30000000000000004. */
function places(step: number): number {
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
  return text.includes('.') ? text.split('.')[1]?.length ?? 0 : 0;
}

/**
 * The value one wheel tick produces, as a string for the control's existing commit path —
 * or `null` for a no-op: a delta of zero, or a value already pinned at the clamp the tick
 * pushes toward (so resting at max never republishes max).
 *
 * A control with no current value starts from `min ?? 0`: scrolling an empty optional field
 * (a blank "start universe") is an edit like any other, and scrolling back down undoes it.
 */
export function wheelStep(o: WheelStepOptions): string | null {
  if (o.deltaY === 0) return null;
  const step = o.step && o.step > 0 ? o.step : 1;
  const text = String(o.value).trim();
  const current = Number(text);
  const hasValue = text !== '' && Number.isFinite(current);
  const base = hasValue ? current : (o.min ?? 0);

  let clamped = base + (o.deltaY < 0 ? step : -step);
  if (o.min !== undefined && clamped < o.min) clamped = o.min;
  if (o.max !== undefined && clamped > o.max) clamped = o.max;

  const rounded = Number(clamped.toFixed(places(step) + 2));
  // Resting against a clamp republishes nothing — but landing ON the base from empty is a
  // real edit (the field gains a value), so only an existing value can be a no-op.
  return hasValue && rounded === base ? null : String(rounded);
}
