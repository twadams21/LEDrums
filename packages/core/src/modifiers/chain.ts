/**
 * The modifier chain runner — the ONE interface the compositor (and the web-sim mirror)
 * uses to apply a voice's resolved modifier chain to its rendered framebuffer, in order,
 * between render and blend. Deep-module seam: callers pass the resolved chain + the voice's
 * per-modifier state array (mutated in place, lazily initialised) and never touch modifier
 * internals.
 *
 * Chain order IS the applied order — links run front-to-back exactly as resolved (graph
 * topology → y-order, S29), never sorted or commuted. Bypassed links are skipped (identity)
 * but keep their state slot so toggling bypass doesn't reset neighbours. An unknown modifier
 * id is skipped, never thrown — the hot path must not fault on stale authored data.
 *
 * `timeMs` is the host voice's local clock and `dt` the frame delta; both are supplied by
 * the caller (the compositor, which owns the voice clock) so modifier code never re-derives
 * time (group-G timebase contract).
 */
import type { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModulations, type ModSampleCtx } from '../voice/modulation';
import { tryGetModifier } from './registry';
import type { ModifierContext, PixelRange, ResolvedModifier } from './types';

/**
 * Apply `chain` to `fb` over `range`, in order. `state` is the voice's per-modifier state
 * array (parallel to `chain`); the runner fills slots lazily via each modifier's
 * `createState` and persists them for the voice's life. No-op for an empty chain — callers
 * gate on `chain.length` to keep the unmodified voice on its zero-alloc path.
 *
 * `modCtx` (doc 10, S33) enables per-param modulation of modifier params: when supplied and
 * a link carries `modulations`, its params are sampled into an effective copy just before
 * `apply` (summed + clamped to the modifier's spec, same model as play-voice params). Omit it
 * — or a link with no `modulations` — and the link runs on its authored params allocation-free.
 */
export function applyModifierChain(
  chain: readonly ResolvedModifier[],
  state: unknown[],
  fb: Framebuffer,
  range: PixelRange,
  model: PixelModel,
  timeMs: number,
  dt: number,
  modCtx?: ModSampleCtx,
): void {
  const ctx: ModifierContext = { model, timeMs, dt };
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;
    if (link.bypass) continue;
    const def = tryGetModifier(link.modifierId);
    if (!def) continue; // unknown id → skip (never throw on the render path)
    if (state[i] === undefined && def.createState) state[i] = def.createState(model, range);
    let params = link.params;
    if (modCtx && link.modulations && link.modulations.length) {
      params = { ...link.params };
      applyModulations(link.params, params, link.modulations, def.paramSpec, modCtx);
    }
    def.apply(ctx, params, fb, range, state[i]);
  }
}
