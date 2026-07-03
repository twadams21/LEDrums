/**
 * Modulation core (doc 10) — the mapping model that drives a param from a source over
 * time, generalizing the old env-only param sweep into summed-and-clamped modulation
 * contributions. ONE model, two carriers: play-voice effect params ({@link Voice.modulations})
 * and modifier-chain params ({@link import('../modifiers/types').ResolvedModifier.modulations}).
 * The graph layer (S34) resolves topology into these flat {@link Mapping} lists at voice
 * spawn; the engine never sees the graph.
 *
 * Pure + deterministic (AGENTS.md hard rule): no IO, no wall-clock, no `Math.random`. A
 * contribution is a pure function of the {@link Mapping} and a {@link ModSampleCtx} (the
 * voice's life phase for envelopes; absolute time + bpm for continuous sources).
 *
 * S33 ships the `envelope` source kind only. `lfo` (S36, pure f(time, bpm)) and `cc` (S37,
 * an engine value-table read) plug in as new {@link ModSource} arms + `sampleSource` cases —
 * no reshaping of {@link Mapping} or the sweep.
 */
import { sampleEnvelope } from './envelope';
import type { Envelope, ParamSpec, ParamValues } from './types';

/**
 * What drives a mapping. A discriminated union keyed by `kind` so new source kinds extend
 * it without reshaping {@link Mapping}: S36 adds `{ kind: 'lfo'; … }`, S37 adds
 * `{ kind: 'cc'; controller; channel }`. Each arm carries its own per-source data ("ref"):
 * an envelope carries its shape (sampled by the host voice's life phase, so each hit runs
 * its own instance).
 */
export type ModSource = { kind: 'envelope'; env: Envelope };

/** The source kinds the model knows. Widens with S36 (`'lfo'`) / S37 (`'cc'`). */
export type ModSourceKind = ModSource['kind'];

/**
 * One resolved modulation mapping onto a single param. `targetParam` is a bare param key
 * relative to the carrier's param spec (the carrier — voice or modifier link — is the
 * play/modifier discriminator, so the mapping itself stays carrier-agnostic). `amount` is
 * the depth 0..1; `invert` flips the source before scaling; `rangeMin`/`rangeMax` bound the
 * mapped value (defaults = the target param spec's min/max, set at resolve time).
 *
 * Multiple mappings on the same `targetParam` SUM their contributions; the sum is clamped
 * once to the spec range (see {@link applyModulations}).
 */
export interface Mapping {
  targetParam: string;
  source: ModSource;
  amount: number;
  invert: boolean;
  rangeMin: number;
  rangeMax: number;
}

/**
 * The per-frame sampling context a mapping reads. `phase` is the host voice's life phase
 * 0..1 — envelope sources sample here, so each hit (and each retrigger, which is a fresh
 * voice with age 0) runs its own envelope instance. `timeMs`/`bpm` are the absolute engine
 * clock + transport tempo, read only by continuous sources (LFO, S36; CC adds its table in
 * S37). Supplied by the caller (the compositor / chain runner), never a global clock.
 */
export interface ModSampleCtx {
  phase: number;
  timeMs: number;
  bpm: number;
}

const num = (v: number | boolean | string | undefined, d: number): number =>
  typeof v === 'number' ? v : d;

/**
 * The subset of a param spec the sweep reads — satisfied by BOTH core param-spec shapes so
 * one sweep serves both carriers: the voice/effect `ParamSpec` (value-type field `kind`) and
 * the modifier/effect-generator `ParamSpec` (value-type field `type`). Only `'number'` params
 * are modulated (others are skipped); the mapping range falls back to `[min, max]`.
 */
export interface ModParamSpec {
  key: string;
  kind?: string;
  type?: string;
  min?: number;
  max?: number;
}

const isNumberSpec = (s: ModParamSpec): boolean => (s.kind ?? s.type) === 'number';

/**
 * Sample a source to its raw 0..1 signal. Envelope: the S23 shape sampled at the voice's
 * life phase. New source kinds add a `case` here (LFO reads `ctx.timeMs`/`ctx.bpm`, CC reads
 * its table) — the exhaustive switch is the extension point.
 */
export function sampleSource(src: ModSource, ctx: ModSampleCtx): number {
  switch (src.kind) {
    case 'envelope':
      return sampleEnvelope(src.env, ctx.phase);
  }
}

/**
 * A single mapping's signed contribution to its target param, base-relative so a chain of
 * summed contributions clamps cleanly and a single envelope mapping reproduces the legacy
 * env sweep exactly: raw source → optional invert → scale into `[rangeMin, rangeMax]` →
 * weighted by `amount` toward that target from `base`. With `range = [spec.min, spec.max]`,
 * `invert = false`, `amount = env.amount`, this equals the old
 * `base + amount·(envTarget − base)` (the parity fixture pins it — see `modulation-parity.ts`).
 */
export function mappingContribution(m: Mapping, base: number, ctx: ModSampleCtx): number {
  const raw = sampleSource(m.source, ctx);
  const s = m.invert ? 1 - raw : raw;
  const target = m.rangeMin + s * (m.rangeMax - m.rangeMin);
  return m.amount * (target - base);
}

function specFor(specs: readonly ModParamSpec[], key: string): ModParamSpec | undefined {
  for (const s of specs) if (s.key === key) return s;
  return undefined;
}

/**
 * Apply `mappings` to `out` (a scratch already filled from `base`), in place and
 * allocation-free: sum each target's base-relative contributions, then clamp once to the
 * param spec range. `base` supplies each contribution's reference value (never `out`, which
 * is being mutated), so several sources on one param sum correctly. Non-number / unknown
 * params are skipped (strings flow through untouched). Two passes over the small mappings
 * list keep the play-voice hot path off the allocator.
 */
export function applyModulations(
  base: ParamValues,
  out: ParamValues,
  mappings: readonly Mapping[],
  specs: readonly ModParamSpec[],
  ctx: ModSampleCtx,
): void {
  // Pass 1: accumulate base-relative contributions onto `out` (which starts at base).
  for (const m of mappings) {
    const spec = specFor(specs, m.targetParam);
    if (!spec || !isNumberSpec(spec)) continue;
    const baseVal = num(base[m.targetParam], spec.min ?? 0);
    out[m.targetParam] = num(out[m.targetParam], baseVal) + mappingContribution(m, baseVal, ctx);
  }
  // Pass 2: clamp each touched target to its spec range (idempotent — dup keys clamp equal).
  for (const m of mappings) {
    const spec = specFor(specs, m.targetParam);
    if (!spec || !isNumberSpec(spec)) continue;
    const lo = spec.min ?? 0;
    const hi = spec.max ?? 1;
    const v = num(out[m.targetParam], lo);
    out[m.targetParam] = v < lo ? lo : v > hi ? hi : v;
  }
}

/**
 * Build the modulation {@link Mapping} equivalent to a legacy per-param {@link Envelope}
 * sweep: an envelope source over the param spec's `[min, max]` range, `amount = env.amount`,
 * no invert — i.e. the pre-modulation compositor's env behaviour expressed as a mapping.
 * S35's EnvMap→envelope-node migration builds mappings this way and proves parity against
 * `modulation-parity.ts`; exported from core so that slice reuses it verbatim.
 */
export function envelopeToMapping(
  param: string,
  env: Envelope,
  spec: Pick<ParamSpec, 'min' | 'max'>,
): Mapping {
  return {
    targetParam: param,
    source: { kind: 'envelope', env },
    amount: env.amount,
    invert: false,
    rangeMin: spec.min ?? 0,
    rangeMax: spec.max ?? 1,
  };
}
