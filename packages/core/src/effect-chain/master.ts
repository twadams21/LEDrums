/**
 * The section **Master chain** (spec "Engine changes → Master chain"): after every voice is
 * composited, the section's `master` modifiers run over the WHOLE frame, before the operator
 * output stage (blackout, master brightness). One pure function shared by the server engine
 * and the web offline Sim, so both agree.
 *
 * - **Resolution.** Each {@link ModifierDevice} resolves exactly as an Effect's modifiers do in
 *   the resolver: modifier id, a copy of its params, `mix`, `bypass` and `envelope` carried for
 *   the chain runner. There are no Control devices on the master chain, so no modulations.
 * - **Execution.** The resolved chain runs through the one modifier chain runner over the
 *   full pixel range, so every link runs once per frame over the whole output (`full-output`).
 * - **Clock.** The runner's `timeMs` is the SECTION clock: ms since the state was last reset
 *   (the caller resets on section recall). A modifier envelope therefore shapes mix over the
 *   section's life, and temporal modifiers (Strobe, Trail…) restart with the section.
 * - **State.** Per-link modifier state lives in an opaque {@link SectionMasterState} the caller
 *   owns. It is rebuilt when the master chain changes identity (a new show) or the pixel count
 *   changes, and cleared by {@link resetSectionMaster}.
 *
 * Pure (no Node/DOM/IO) and deterministic: a function of (frame, master, state, ctx).
 */
import type { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from '../modifiers/chain';
import type { ResolvedModifier } from '../modifiers/types';
import type { ModifierDevice } from './types';

/** Opaque per-section master state. Create with {@link createSectionMasterState}. */
export interface SectionMasterState {
  /** @internal The master chain the resolved links / slots were built for. */
  chain: readonly ModifierDevice[] | null;
  /** @internal Pixel count the modifier state slots were sized for. */
  pixelCount: number;
  /** @internal Resolved links, parallel to {@link chain}. */
  resolved: ResolvedModifier[];
  /** @internal Per-link modifier state, parallel to {@link resolved}. */
  slots: unknown[];
  /** @internal Engine time (ms) the section clock started, latched on the first apply. */
  originMs: number | null;
}

/** The clock + geometry the master stage reads. `timeMs` is the ENGINE clock (ms). */
export interface SectionMasterCtx {
  model: PixelModel;
  timeMs: number;
  /** Frame delta in ms. */
  dt: number;
  /** The transport tempo (a Strobe in divisions reads it); absent → 120. */
  bpm?: number;
}

export function createSectionMasterState(): SectionMasterState {
  return { chain: null, pixelCount: -1, resolved: [], slots: [], originMs: null };
}

/**
 * Restart the section clock and drop every link's modifier state. Call on section recall and
 * when the pixel model changes. The next {@link applySectionMaster} starts the clock at 0.
 */
export function resetSectionMaster(state: SectionMasterState): void {
  state.chain = null;
  state.pixelCount = -1;
  state.resolved = [];
  state.slots = [];
  state.originMs = null;
}

/** One master ModifierDevice → the chain runner's link, the same mapping the resolver uses. */
function resolveMasterLink(m: ModifierDevice): ResolvedModifier {
  const link: ResolvedModifier = { modifierId: m.modifierId, params: { ...m.params }, mix: m.mix };
  if (m.bypass) link.bypass = true;
  if (m.envelope) link.envelope = { ...m.envelope };
  return link;
}

/**
 * Run the section's `master` modifiers over the whole composited frame, in place. An empty or
 * absent chain is a no-op (the frame is untouched), so a section without a master chain keeps
 * today's output exactly.
 */
export function applySectionMaster(
  frameFb: Framebuffer,
  master: readonly ModifierDevice[] | undefined,
  state: SectionMasterState,
  ctx: SectionMasterCtx,
): void {
  if (!master || master.length === 0) return;
  const pixelCount = ctx.model.pixelCount;
  if (state.chain !== master || state.pixelCount !== pixelCount) {
    state.chain = master;
    state.pixelCount = pixelCount;
    state.resolved = master.map(resolveMasterLink);
    state.slots = [];
  }
  state.originMs ??= ctx.timeMs;
  const sectionMs = Math.max(0, ctx.timeMs - state.originMs);
  applyModifierChain(
    state.resolved, state.slots, frameFb, { start: 0, end: pixelCount }, ctx.model, sectionMs, ctx.dt,
    ctx.bpm === undefined ? undefined : { phase: 0, timeMs: sectionMs, bpm: ctx.bpm },
  );
}
