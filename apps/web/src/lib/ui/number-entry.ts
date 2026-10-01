/* Typing an exact value into a slider's number box (Tim, 2026-10-02: "i can't type in a number
   into any of the boxes"). Pure, so the parsing — the part with decisions in it — is tested
   without a DOM. The box shows and accepts the value in the units it is displayed in: a percent
   param (0..1 shown as 25) is typed as 25; a millisecond param accepts `1.5s`; a beats param
   accepts a division (`1/8` = half a beat). */

/** How a value is shown in, and read back from, the box. */
export interface EntryScale {
  /** Multiplier from the stored value to the typed one (100 for a 0..1 percent). Default 1. */
  factor?: number;
  /** The display unit: `ms` also reads `s` (`1.5s` → 1500), `beats` also reads a division. */
  unit?: string;
}

/** The text the box starts with: the value in display units, without needless decimals. */
export function entryText(value: number, scale: EntryScale = {}): string {
  const shown = value * (scale.factor ?? 1);
  return String(Number(shown.toFixed(4)));
}

/** A division (`1/8`, `1/4.` dotted, `1/8t` triplet) as beats, where a quarter note is 1 beat. */
function divisionBeats(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(\.|d|dotted|t|triplet)?$/i.exec(text);
  if (!m) return null;
  const base = (Number(m[1]) / Number(m[2])) * 4;
  if (!Number.isFinite(base)) return null;
  const mod = (m[3] ?? '').toLowerCase();
  if (mod === '.' || mod === 'd' || mod === 'dotted') return base * 1.5;
  if (mod === 't' || mod === 'triplet') return (base * 2) / 3;
  return base;
}

/**
 * The stored value a typed entry means, or null when it isn't a number. Units are optional and
 * forgiving: `250`, `250ms`, `0.25s` all mean 250 for a millisecond param; `1/8` means 0.5 for a
 * beats param; `25`, `25%` mean 0.25 for a percent one. Not clamped — the caller clamps.
 */
export function parseEntry(text: string, scale: EntryScale = {}): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  const factor = scale.factor ?? 1;
  if (scale.unit === 'beats') {
    const div = divisionBeats(t);
    if (div !== null) return div / factor;
  }
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z%°]*)$/.exec(t);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  if (scale.unit === 'ms' && suffix === 's') n *= 1000;
  if (scale.unit === 's' && suffix === 'ms') n /= 1000;
  return n / factor;
}

/** Clamp a typed value to the param's range and to the precision its step implies. */
export function clampEntry(value: number, min: number | undefined, max: number | undefined, step: number | undefined): number {
  let v = value;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  // An integer step means an integer param; a fractional step sets how many decimals matter.
  // Typed values are NOT snapped to the step grid — typing is for exact values.
  if (step !== undefined && step >= 1 && Number.isInteger(step)) return Math.round(v);
  const decimals = step !== undefined && step > 0 ? Math.min(6, Math.max(2, Math.ceil(-Math.log10(step)) + 1)) : 6;
  return Number(v.toFixed(decimals));
}
