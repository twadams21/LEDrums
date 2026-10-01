/**
 * The modifier chain runner — the ONE interface the compositor (and the web-sim mirror)
 * uses to apply a voice's resolved modifier chain to its rendered framebuffer, in order,
 * between render and blend. Deep-module seam: callers pass the resolved chain + the voice's
 * per-modifier state array (mutated in place, lazily initialised) and never touch modifier
 * internals.
 *
 * Chain order IS the applied order — links run front-to-back exactly as resolved (the
 * Effect's modifier device order), never sorted or commuted. Bypassed links are skipped (identity)
 * but keep their state slot so toggling bypass doesn't reset neighbours. An unknown modifier
 * id is skipped, never thrown — the hot path must not fault on stale authored data.
 *
 * `timeMs` is the host voice's local clock and `dt` the frame delta; both are supplied by
 * the caller (the compositor, which owns the voice clock) so modifier code never re-derives
 * time (group-G timebase contract).
 *
 * Per-link dry/wet (effect chains): a link with `mix` < 1 or an `envelope` snapshots its range
 * before `apply`, then lerps `out = dry + (wet − dry) × clamp01(mix) × envGain(timeMs)`. The
 * envelope clock is the same `timeMs`. Mix applies per range for range-local links and over
 * the whole frame for full-output links; every other link runs exactly as before.
 */
import type { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { clamp01 } from '../math';
import { applyModulations, type ModSampleCtx } from '../voice/modulation';
import { tryGetModifier } from './registry';
import type { ModifierContext, ModifierEnvelope, PixelRange, ResolvedModifier } from './types';

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
  const ctx: ModifierContext = { model, timeMs, dt, bpm: modCtx?.bpm };
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
    // Dry/wet: only a link with mix < 1 or an envelope leaves today's exact path (-1 = none).
    const mixEff = linkMix(link, timeMs);
    if (scoped && def.scopePolicy === 'range-local') {
      // Opaque to callers, like every other modifier-state slot.
      const byRange = (state[i] ??= new Map<string, unknown>()) as Map<string, unknown>;
      for (const key of byRange.keys()) {
        if (!ranges.some((r) => key === `${r.start}:${r.end}`)) byRange.delete(key);
      }
      for (const range of ranges) {
        const key = `${range.start}:${range.end}`;
        if (!byRange.has(key)) byRange.set(key, def.createState?.(model, range));
        if (mixEff >= 0) snapshotRange(fb, range);
        def.apply(ctx, params, fb, range, byRange.get(key));
        if (mixEff >= 0) mixRange(fb, range, mixEff);
      }
    } else {
      const range = scoped ? { start: 0, end: model.pixelCount } : ranges[0]!;
      if (state[i] === undefined && def.createState) state[i] = def.createState(model, range);
      if (mixEff >= 0) snapshotRange(fb, range);
      def.apply(ctx, params, fb, range, state[i]);
      if (mixEff >= 0) mixRange(fb, range, mixEff);
    }
  }
}

/**
 * The link's effective wet amount `clamp01(mix) × envGain(age)`, or -1 when the link takes
 * today's exact path (mix absent or ≥ 1, and no envelope). A wet amount of 0 still runs
 * `apply` — stateful modifiers keep their clocks and buffers advancing — and then restores
 * the dry input, so a later envelope stage fades in over a live (not stale) modifier.
 */
function linkMix(link: ResolvedModifier, ageMs: number): number {
  const mix = link.mix;
  if (!link.envelope && (mix === undefined || mix >= 1)) return -1;
  const m = mix === undefined || Number.isNaN(mix) ? 1 : clamp01(mix);
  return link.envelope ? m * envelopeGain(link.envelope, ageMs) : m;
}

/** ADSR gain 0..1 at voice age `t` (ms); see {@link ModifierEnvelope} for the stages. */
function envelopeGain(env: ModifierEnvelope, t: number): number {
  const sustain = clamp01(env.sustainLevel);
  const length = env.lengthMs;
  if (length === undefined || t < length) return adsGain(env, sustain, t);
  const release = Math.max(0, env.releaseMs);
  const since = t - length;
  if (since >= release) return 0;
  return adsGain(env, sustain, length) * (1 - since / release);
}

/** The attack → decay → sustain part of the envelope (no gate). */
function adsGain(env: ModifierEnvelope, sustain: number, t: number): number {
  const attack = Math.max(0, env.attackMs);
  if (t < attack) return t <= 0 ? 0 : t / attack;
  const decay = Math.max(0, env.decayMs);
  const intoDecay = t - attack;
  if (intoDecay < decay) return 1 - (1 - sustain) * (intoDecay / decay);
  return sustain;
}

/** Preallocated dry snapshot, grown to the largest range seen; never shrinks. Shared by every
 * chain run (the runner is synchronous and a snapshot lives only within one link), so the
 * dry/wet path allocates nothing per frame after warm-up. */
let dry = new Float32Array(0);

function snapshotRange(fb: Framebuffer, range: PixelRange): void {
  const from = range.start * 4;
  const to = range.end * 4;
  if (dry.length < to - from) dry = new Float32Array(to - from);
  const px = fb.rgba;
  for (let j = from, k = 0; j < to; j++, k++) dry[k] = px[j]!;
}

/** `fb = dry + (wet − dry) × t` over `range`, all four channels. t = 1 leaves the wet output. */
function mixRange(fb: Framebuffer, range: PixelRange, t: number): void {
  if (t >= 1) return;
  const from = range.start * 4;
  const to = range.end * 4;
  const px = fb.rgba;
  if (t <= 0) {
    for (let j = from, k = 0; j < to; j++, k++) px[j] = dry[k]!;
    return;
  }
  for (let j = from, k = 0; j < to; j++, k++) {
    const d = dry[k]!;
    px[j] = d + (px[j]! - d) * t;
  }
}
