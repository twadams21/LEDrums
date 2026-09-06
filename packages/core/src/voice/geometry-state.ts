import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { EffectGenerator } from '../effects/types';

/** Runtime state for a splice member's bounded material regeneration.
 *
 * `genState` remains the current generation for compatibility with the ordinary generator
 * bridge and existing diagnostics. `previous` is retained only during the short boundary
 * crossfade; both carriers are engine-owned and are checkpointed with the member.
 */
export interface MaterialCycleState {
  cycleIndex: number;
  currentSeed: number;
  currentSeq: number;
  currentRendered: boolean;
  /** Last assembled generator output for the current cycle, before modifiers. */
  currentFrame: Framebuffer;
  previous: {
    cycleIndex: number;
    seed: number;
    seq: number;
    /** Frozen output from the immediately preceding cycle; never re-rendered. */
    framebuffer: Framebuffer;
  } | null;
}

/** Runtime-only geometry ownership, shared by voices and composite members. Model objects
 * are immutable revisions: even an equal-total replacement invalidates trails/particles.
 * This resets visual state, NOT the voice's age, envelope, identity or latch/motion clock.
 */
export interface GeometryState {
  renderModel?: PixelModel;
  /** Registry adapter identity; a live canvas upsert must also rebuild its sampler. */
  renderGenerator?: EffectGenerator;
  genState?: unknown;
  materialCycle?: MaterialCycleState;
  modState?: unknown[];
  mixInputs?: GeometryState[];
  spliceInputs?: GeometryState[];
}

/** null detaches all geometry ownership, including adapters that close over Canvas docs. */
export function ensureGeometryState(state: GeometryState, model: PixelModel | null): void {
  if (model && state.renderModel === model) return;
  state.renderModel = model ?? undefined;
  state.renderGenerator = undefined;
  state.genState = null;
  state.materialCycle = undefined;
  state.modState = undefined;
  for (const member of state.mixInputs ?? []) ensureGeometryState(member, model);
  for (const member of state.spliceInputs ?? []) ensureGeometryState(member, model);
}
