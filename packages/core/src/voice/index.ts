/**
 * Voice-bus lighting brain — the voice engine that plays authored Effects, behind a clean
 * deep-module seam.
 *
 * - {@link RenderEngine} (outer seam): host ↔ brain.
 * - {@link Compositor} (inner seam): voices → pixels (the perf hotspot).
 * - {@link Show}: the runtime content aggregate (songs → sections → Effects).
 *
 * Pure + deterministic: no Node/DOM/IO, no `Math.random` / `Date.now` (a seeded
 * {@link Prng} carries all randomness).
 */
export * from './types';
export * from './diagnostics';
export * from './easing';
export * from './envelope';
export { ensureGeometryState, type GeometryState, type MaterialCycleState } from './geometry-state';
export { VoicePool, releaseVoice, type SpawnDeps } from './voice-pool';
export { advanceEnvelopes, reapDeadVoices } from './envelope-tick';
export { shapeCascadeVoice, advanceLatchedSpliceMotion } from './runtime-policy';
export * from './modulation';
export * from './audio-features';
export * from './scope';
export * from './navigation';
export {
  MODULATION_PARITY_CASES,
  PARITY_PHASES,
  legacyEnvValue,
  mappingEnvValue,
  type ParityCase,
} from './modulation-parity';
export * from './prng';
export { computeDelayMs, DELAY_DIVISIONS, type DelayDivision } from './delay';
export * from './binding-claims';
export {
  DEFAULT_SPLICE_ATTACK_MS,
  DEFAULT_SPLICE_COUNT,
  DEFAULT_SPLICE_DIVISION,
  DEFAULT_SPLICE_HOLD_MS,
  DEFAULT_SPLICE_INCREMENT_PX,
  DEFAULT_SPLICE_RATE_MS,
  DEFAULT_SPLICE_RELEASE_MS,
  MAX_SPLICE_COUNT,
  MAX_SPLICE_ENVELOPE_MS,
  MAX_SPLICE_INCREMENT_PX,
  MIN_SPLICE_COUNT,
  SPLICE_FILL_EFFECT_ID,
  SPLICE_FILL_GENERATOR_ID,
  chasePixelShift,
  chaseStaggerShift,
  chaseStepOffset,
  colorCascadeDelayMs,
  computeSpliceBands,
  forEachPartitionUnit,
  forEachSpliceBand,
  forEachSpliceSegment,
  firstUnitWithMaterial,
  spliceFeatherPx,
  isBlankSplice,
  resolveSplices,
  spliceDefAt,
  spliceOrderIndex,
  splicePulseCycleMs,
  spliceRotationPx,
  spliceSourceOffset,
  spliceTintColour,
  maxCascadeDelayMs,
  unitCascadeDelayMs,
  unitEnvelopeLevel,
  unitFadeInLevel,
  unitMotionAge,
  tintPixel,
  wrapIndex,
  type ResolvedSpliceMember,
  type ResolvedSplices,
  type SpliceBand,
  type SplicePartitionUnit,
  orderedByPattern,
  sequenceRanks,
  spliceDrumRanks,
  spliceUnitOrder,
} from './splice';
export * from './slice';
export type { PlayAction, PlayDraft, MixInputDraft } from './play-action';
// S36 — LFO (a Control device's shape)
export {
  LFO_WAVEFORMS,
  defaultLfoSettings,
  lfoPeriodMs,
  sampleLfo,
  type LfoWaveform,
  type LfoRateMode,
  type LfoSettings,
} from './lfo';
export {
  createDefaultCompositor,
  applyEffectiveParams,
  voicePhase,
  type Compositor,
  type CompositorFrame,
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
