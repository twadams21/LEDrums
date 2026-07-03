/**
 * Voice-bus lighting brain — the trigger-graph / voice-bus model ported from the
 * throwaway `trigger-lab` simulation into pure core, behind a clean deep-module seam.
 *
 * - {@link RenderEngine} (outer seam): host ↔ brain.
 * - {@link Compositor} (inner seam): voices → pixels (the perf hotspot).
 * - {@link Show}: the authored content aggregate.
 *
 * Pure + deterministic: no Node/DOM/IO, no `Math.random` / `Date.now` (a seeded
 * {@link Prng} carries all randomness). Additive, not yet wired into anything.
 */
export * from './types';
export * from './diagnostics';
export * from './easing';
export * from './envelope';
export * from './modulation';
export {
  MODULATION_PARITY_CASES,
  PARITY_PHASES,
  legacyEnvValue,
  mappingEnvValue,
  type ParityCase,
} from './modulation-parity';
export * from './prng';
export { computeDelayMs, DELAY_DIVISIONS, type DelayDivision } from './delay';
// S36 — LFO source node
export {
  LFO_WAVEFORMS,
  defaultLfoSettings,
  lfoPeriodMs,
  sampleLfo,
  type LfoWaveform,
  type LfoRateMode,
  type LfoSettings,
} from './lfo';
export { resolveModifierChain } from './modifier-graph';
export {
  resolveNodeModulations,
  nodeModSource,
  paramKeyOf,
  isModSourceKind,
  ENVELOPE_NODE_KEY,
  MOD_SOURCE_KINDS,
} from './modulation-graph';
export {
  buildPixelAttrs,
  createDefaultCompositor,
  applyEffectiveParams,
  voicePhase,
  type Compositor,
  type CompositorFrame,
  type PixelAttrs,
} from './compositor';
export {
  createVoiceBusEngine,
  createNullEngine,
  type RenderEngine,
  type RenderEngineOptions,
  type InputEvent,
  type EngineStats,
  type VoiceStat,
} from './engine';
