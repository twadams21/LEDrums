/**
 * Delay node helpers — pure math for converting a musical division + bpm into
 * milliseconds. Shared between the core engine (pending-fire enqueue path) and the
 * web-mirror slice so the two implementations stay byte-identical. No IO, no
 * wall-clock, no Math.random.
 */

/** The full canonical set of delay divisions the delay node supports. */
export const DELAY_DIVISIONS = [
  '1/4',
  '1/8',
  '1/16',
  'dotted-1/4',
  'dotted-1/8',
  'dotted-1/16',
  'triplet-1/4',
  'triplet-1/8',
  'triplet-1/16',
] as const;

export type DelayDivision = (typeof DELAY_DIVISIONS)[number];

/**
 * Compute the delay in milliseconds for a delay node.
 *
 * - `mode === 'time'`: returns `ms` directly — absolute, bpm-independent.
 * - `mode === 'beats'`: resolves `division` against `bpm` at enqueue time:
 *     - `1/4`  → `60000 / bpm`  (quarter note)
 *     - `1/8`  → `30000 / bpm`  (eighth note)
 *     - `1/16` → `15000 / bpm`  (sixteenth note)
 *     - `dotted-*`  → base × 1.5
 *     - `triplet-*` → base × (2/3)
 *   Unknown divisions default to the quarter note duration.
 *
 * Returns the computed ms value; if the result is ≤ 0 the caller must fire children
 * immediately (no enqueue). The computation is snapshot-stable: the caller stores the
 * resolved value so later bpm changes do NOT alter it.
 */
export function computeDelayMs(
  mode: 'time' | 'beats',
  ms: number,
  division: string,
  bpm: number,
): number {
  if (mode === 'time') return ms;

  // Beats mode: strip the modifier prefix and resolve the base duration.
  const quarter = 60000 / bpm;
  const clean = division.replace('dotted-', '').replace('triplet-', '');
  let base: number;
  if (clean === '1/8') base = quarter / 2;
  else if (clean === '1/16') base = quarter / 4;
  else base = quarter; // '1/4' or any unknown → quarter note

  if (division.startsWith('dotted-')) return base * 1.5;
  if (division.startsWith('triplet-')) return base * (2 / 3);
  return base;
}
