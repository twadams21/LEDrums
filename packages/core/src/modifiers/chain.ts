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
  runChain(chain, state, fb, [range], model, timeMs, dt, modCtx, false);
}

/** Scoped-runtime contract: full-output links (temporal/noise) run ONCE over the generated/assembled
 * output, before the final scope mask. Their clocks/rings never advance per selected hoop.
 * Other links operate independently on each canonical contiguous selected run. Adjacent
 * ranges must be coalesced by the caller, so equivalent pixel sets have identical semantics.
 * Chain order is retained (not a temporal/spatial sorting pass). Each spatial run has its
 * own state, preventing range-sized scratch or seeded maps from bleeding between runs.
 */
export function applyScopedModifierChain(
  chain: readonly ResolvedModifier[], state: unknown[], fb: Framebuffer,
  ranges: readonly PixelRange[], model: PixelModel, timeMs: number, dt: number, modCtx?: ModSampleCtx,
): void {
  runChain(chain, state, fb, ranges, model, timeMs, dt, modCtx, true);
}

function runChain(
  chain: readonly ResolvedModifier[], state: unknown[], fb: Framebuffer,
  ranges: readonly PixelRange[], model: PixelModel, timeMs: number, dt: number,
  modCtx: ModSampleCtx | undefined, scoped: boolean,
): void {
  if (!ranges.length) return;
  const ctx: ModifierContext = { model, timeMs, dt };
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;
    if (link.bypass) continue;
    const def = tryGetModifier(link.modifierId);
    if (!def) continue; // unknown id → skip (never throw on the render path)
    let params = link.params;
    if (modCtx && link.modulations && link.modulations.length) {
      params = { ...link.params };
      applyModulations(link.params, params, link.modulations, def.paramSpec, modCtx);
    }
    if (scoped && def.scopePolicy === 'range-local') {
      // Opaque to callers, like every other modifier-state slot.
      const byRange = (state[i] ??= new Map<string, unknown>()) as Map<string, unknown>;
      for (const key of byRange.keys()) {
        if (!ranges.some((r) => key === `${r.start}:${r.end}`)) byRange.delete(key);
      }
      for (const range of ranges) {
        const key = `${range.start}:${range.end}`;
        if (!byRange.has(key)) byRange.set(key, def.createState?.(model, range));
        def.apply(ctx, params, fb, range, byRange.get(key));
      }
    } else {
      const range = scoped ? { start: 0, end: model.pixelCount } : ranges[0]!;
      if (state[i] === undefined && def.createState) state[i] = def.createState(model, range);
      def.apply(ctx, params, fb, range, state[i]);
    }
  }
}
