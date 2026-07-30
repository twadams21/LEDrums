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
export * from './scope';
export * from './graph-integrity';
export * from './render-plan';
// middle-man-0003: the five fixtures from ./modulation-parity deliberately do NOT ship on this
// namespace. One of them reimplements the SUPERSEDED envelope formula and was published here only
// so a cross-package migration test could reach it — an implementer could have called it and got
// deliberately-wrong math. They now live behind the test-only entry point
// `@ledrums/core/test-fixtures` (packages/core/src/test-fixtures.ts). Do not re-add them here.
// (Symbol names are intentionally not spelled out, so the step's grep guard stays mechanical.)
export * from './prng';
export { computeDelayMs, DELAY_DIVISIONS, type DelayDivision } from './delay';
export {
  evalGraph,
  evalChildren,
  type Action,
  type EvalState,
  type PendingDescriptor,
  type PlayAction,
  type PlayDraft,
  type MixInputDraft,
  type TriggerCtx as EvalTriggerCtx,
} from './eval-graph';
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
export { resolveModifierChain, resolveModifierNode } from './modifier-graph';
export {
  resolveNodeModulations,
  nodeModSource,
  paramKeyOf,
  isModSourceKind,
  ENVELOPE_NODE_KEY,
  MOD_SOURCE_KINDS,
  type ModSourceKind,
} from './modulation-graph';
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
