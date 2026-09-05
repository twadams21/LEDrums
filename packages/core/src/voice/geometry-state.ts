import type { PixelModel } from '../geometry/pixel-model';
import type { EffectGenerator } from '../effects/types';

/** Runtime-only geometry ownership, shared by voices and composite members. Model objects
 * are immutable revisions: even an equal-total replacement invalidates trails/particles.
 * This resets visual state, NOT the voice's age, envelope, identity or latch/motion clock.
 */
export interface GeometryState {
  renderModel?: PixelModel;
  /** Registry adapter identity; a live canvas upsert must also rebuild its sampler. */
  renderGenerator?: EffectGenerator;
  genState?: unknown;
  modState?: unknown[];
  mixInputs?: GeometryState[];
  spliceInputs?: GeometryState[];
}

export function ensureGeometryState(state: GeometryState, model: PixelModel): void {
  if (state.renderModel === model) return;
  state.renderModel = model;
  state.genState = null;
  state.modState = undefined;
  for (const member of state.mixInputs ?? []) ensureGeometryState(member, model);
  for (const member of state.spliceInputs ?? []) ensureGeometryState(member, model);
}
