/* Splitting a formatted read-out back into its number and its unit, extracted so the rule is
   unit-testable without a DOM.

   The Slider shows a formatted read-out ("210°", "1500 ms", "4 beats") but edits a raw number,
   so it has to know which part of that string is the number. It used to do this by SLICING the
   formatted text at the length of its own numeric rendering — and those two renderings do not
   agree: a 0.01-step param formats as `0.60` (two fixed decimals) while the input renders the
   same value as `0.6` (trailing zeros trimmed). Slicing 3 characters off `0.60` left `0`, which
   the Slider then displayed as the param's UNIT, outside the input box. That's the stray zero
   Trent hit on a 0.60 slider.

   Parsing the leading numeric token instead is exact for every formatting either side chooses,
   and it tells the caller the number the format actually printed — so `0.60` can be shown in
   the box the way the spec formats it, trailing zero and all. */

export interface ValueUnit {
  /** The leading numeric token exactly as the formatter printed it, or null if there is none. */
  number: string | null;
  /** Whatever followed it, trimmed — the unit. The whole string when there is no number. */
  unit: string;
}

/** Matches a leading signed decimal (optionally in exponent form) and keeps the remainder. */
const LEADING_NUMBER = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(.*)$/s;

/**
 * Split a formatted read-out into its number and its unit.
 *
 * `"210°"` → `{ number: '210', unit: '°' }` · `"1500 ms"` → `{ number: '1500', unit: 'ms' }` ·
 * `"0.60"` → `{ number: '0.60', unit: '' }` · `"swept"` → `{ number: null, unit: 'swept' }`.
 */
export function splitValueUnit(display: string): ValueUnit {
  const m = LEADING_NUMBER.exec(display ?? '');
  if (!m) return { number: null, unit: (display ?? '').trim() };
  return { number: m[1]!, unit: (m[2] ?? '').trim() };
}
