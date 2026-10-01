/**
 * Tempo-synced params (Tim, 2026-10-02: "allow the option for beats / subdivisions everywhere
 * there is a measurement of time"). Any number param whose unit is a duration (`ms`) or a rate
 * (`Hz`) may carry a companion `<key>:beats`. When it does, the companion wins and the param
 * follows the tempo:
 *   - a duration lasts that many beats:            ms = beats × 60000 / bpm
 *   - a rate runs one cycle per that many beats:   Hz = bpm / (60 × beats)
 * The ms / Hz value is kept beside it, so switching back restores it, and a show saved before
 * this has no companions and plays exactly as it did. Pure, and allocation-free on a show that
 * uses none: callers scan for the suffix before copying.
 */
/** The part of a param spec the rule reads (the effect and voice spec types both have it). */
export interface TempoSpec {
  key: string;
  unit?: string;
  min?: number;
  max?: number;
}

export const TEMPO_SUFFIX = ':beats';

/** The companion key that puts `key` in beats. */
export const tempoKey = (key: string): string => `${key}${TEMPO_SUFFIX}`;

/** Can this param be put in beats — a number measured in ms or Hz? */
export function isTempoUnit(unit: string | undefined): unit is 'ms' | 'Hz' {
  return unit === 'ms' || unit === 'Hz';
}

/** Does this param bag carry any tempo companion? (No allocation.) */
export function hasTempoParams(params: Readonly<Record<string, unknown>>): boolean {
  for (const key in params) if (key.endsWith(TEMPO_SUFFIX)) return true;
  return false;
}

/** The ms / Hz a beats companion stands for at `bpm`, or null when it cannot (0 beats, no unit). */
export function tempoValue(unit: string | undefined, beats: number, bpm: number): number | null {
  if (!(beats > 0) || !Number.isFinite(beats)) return unit === 'ms' ? 0 : null;
  const tempo = bpm > 0 ? bpm : 120;
  if (unit === 'ms') return (beats * 60000) / tempo;
  if (unit === 'Hz') return tempo / (60 * beats);
  return null;
}

/**
 * Write each companion's tempo-resolved value over its param, in place. `specs` give the units.
 * A companion naming a param that is not a ms / Hz number is ignored.
 */
export function resolveTempoParams(params: Record<string, unknown>, specs: readonly TempoSpec[], bpm: number): void {
  for (const key in params) {
    if (!key.endsWith(TEMPO_SUFFIX)) continue;
    const beats = params[key];
    if (typeof beats !== 'number') continue;
    const base = key.slice(0, -TEMPO_SUFFIX.length);
    const spec = specs.find((s) => s.key === base);
    if (!spec || !isTempoUnit(spec.unit)) continue;
    const value = tempoValue(spec.unit, beats, bpm);
    if (value === null) continue;
    params[base] = spec.max !== undefined ? Math.min(spec.max, Math.max(spec.min ?? 0, value)) : Math.max(spec.min ?? 0, value);
  }
}
