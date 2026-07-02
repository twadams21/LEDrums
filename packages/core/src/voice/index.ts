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
export * from './envelope';
export * from './prng';
export { computeDelayMs, DELAY_DIVISIONS, type DelayDivision } from './delay';
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
