/**
 * Legacy env-sweep ↔ modulation-mapping PARITY FIXTURE (S33 → S35). Proves that a legacy
 * per-param {@link Envelope} sweep and its equivalent {@link Mapping} produce
 * sample-identical output across the voice life phase. S33 pins it as an acceptance test;
 * S35's `EnvMap`→envelope-node migration reuses these cases + helpers to prove pre-migration
 * behaviour is byte-preserved after the legacy field is removed. Importable + reusable — do
 * not inline these into a test file.
 *
 * Pure: the two `*Value` helpers are the ONLY definitions of "how a legacy env swept a param"
 * and "how the modulation model maps it"; keeping both here (not in the compositor / a test)
 * lets both slices assert against one source of truth.
 */
import { sampleEnvelope } from './envelope';
import { applyModulations, envelopeToMapping, type ModSampleCtx } from './modulation';
import type { Envelope, ParamSpec } from './types';

const num = (v: number | boolean | string | undefined, d: number): number =>
  typeof v === 'number' ? v : d;

/** One representative parity scenario: a param spec, its base (spawn) value, and an env. */
export interface ParityCase {
  label: string;
  spec: ParamSpec;
  base: number;
  env: Envelope;
}

/** Phases spanning the voice life (attack → release), including the exact endpoints. */
export const PARITY_PHASES: readonly number[] = [0, 0.05, 0.12, 0.25, 0.4, 0.5, 0.63, 0.75, 0.88, 1];

function env(kind: Envelope['kind'], amount: number, points: { t: number; v: number }[]): Envelope {
  return { kind, amount, points };
}

/**
 * Canonical cases: unit-range + non-unit-range specs, full/partial amount, and each preset
 * plus a hand-authored custom shape — the shapes the migrator will encounter.
 */
export const MODULATION_PARITY_CASES: readonly ParityCase[] = [
  {
    label: 'decay, unit range, full amount',
    spec: { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 },
    base: 1,
    env: env('decay', 1, [
      { t: 0, v: 1 },
      { t: 1, v: 0 },
    ]),
  },
  {
    label: 'rise, unit range, partial amount',
    spec: { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0.5 },
    base: 0.5,
    env: env('rise', 0.6, [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ]),
  },
  {
    label: 'custom breakpoints, non-unit range (speed 0..4)',
    spec: { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, default: 1 },
    base: 1,
    env: env('custom', 0.75, [
      { t: 0, v: 0.2 },
      { t: 0.4, v: 1 },
      { t: 0.7, v: 0.3 },
      { t: 1, v: 0.9 },
    ]),
  },
  {
    label: 'pluck, offset base inside range (width 0.1..0.9)',
    spec: { key: 'width', label: 'Width', kind: 'number', min: 0.1, max: 0.9, default: 0.5 },
    base: 0.5,
    env: env('pluck', 1, [
      { t: 0, v: 0 },
      { t: 0.12, v: 1 },
      { t: 1, v: 0.1 },
    ]),
  },
];

/**
 * The legacy env-sweep formula (the pre-modulation compositor's per-param inner loop),
 * as a pure function. Kept identical to `applyEffectiveParams`'s historical env branch so
 * "legacy behaviour" has one authoritative definition.
 */
export function legacyEnvValue(spec: ParamSpec, base: number, e: Envelope, phase: number): number {
  const lo = spec.min ?? 0;
  const hi = spec.max ?? 1;
  const target = lo + sampleEnvelope(e, phase) * (hi - lo);
  return base + (target - base) * e.amount;
}

/** The same param value resolved through the modulation model (equivalent mapping). */
export function mappingEnvValue(spec: ParamSpec, base: number, e: Envelope, phase: number): number {
  const mapping = envelopeToMapping(spec.key, e, spec);
  const baseParams = { [spec.key]: base };
  const out = { [spec.key]: base };
  const ctx: ModSampleCtx = { phase, timeMs: 0, bpm: 120 };
  applyModulations(baseParams, out, [mapping], [spec], ctx);
  return num(out[spec.key], base);
}
