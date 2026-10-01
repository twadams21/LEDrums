/**
 * Effect modifiers — the "media effects" layer (Resolume analog: Grain / Bloom / Trail…).
 * A modifier is a pure, per-instance transform over a voice's rendered framebuffer, applied
 * BETWEEN the generator/pattern render and the compositor blend (see `compositor.ts` /
 * `generator-bridge.ts`). This registry mirrors `effects/registry.ts`: one deep module per
 * modifier, and the chain runner ({@link applyModifierChain}) is the only interface the
 * compositor sees.
 *
 * Model: an Effect's Modifier devices resolve (at fire time, `effect-chain/resolver.ts`)
 * into a flat {@link ResolvedModifier}[] carried on the voice — the resolved chain is the
 * interface the engine sees (registry + chain runner + compositor hook).
 *
 * Purity is a hard non-negotiable (AGENTS.md): `apply` is a pure, deterministic function of
 * (ctx, params, fb, range, state) — no IO, no wall-clock, no `Math.random`. Any per-instance
 * state (accumulators, ring buffers, seeded RNG cursors) lives in `State`, is built by
 * `createState`, and RESETS with the voice (per-voice-state rule — see group-G handoff).
 */
import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { ParamSpec, ResolvedParams } from '../effects/types';
import type { Mapping } from '../voice/modulation';

export type { ParamSpec, ResolvedParams };

/** Category chip for the palette/inspector (mirrors the doc 06 §C modifier table columns). */
export type ModifierCategory = 'temporal' | 'spatial' | 'texture' | 'color';

/** A contiguous pixel range `[start, end)` — the voice's resolved scope on the frame. */
export interface PixelRange {
  start: number;
  end: number;
}

/**
 * The clock + geometry a modifier reads. `timeMs` is the HOST VOICE's clock (voice-local
 * age — inherited through the compositor, never re-derived inside modifier code: group-G
 * contract) so temporal modifiers restart with the voice on retrigger. `dt` is the frame
 * delta (ms) — temporal modifiers (Trail/Echo/Strobe) integrate against it.
 */
export interface ModifierContext {
  model: PixelModel;
  /** Host voice's local clock in ms (age since the voice's originating hit; ≥ 0). */
  timeMs: number;
  /** Frame delta in ms. */
  dt: number;
  /** The transport tempo, when the host knows it — a tempo-synced modifier (Strobe in
      divisions) reads it; absent → 120. */
  bpm?: number;
}

/** Single-render undo journal, owned by one live modifier state. capture replaces the
 * baseline; restore may be repeated and must return that exact pre-apply state without
 * consuming RNG or time. The modifier must cover EVERY mutation of one apply, including
 * bypass/no-op calls, and may retain untouched history only while owning it exclusively.
 * Used only for full-output modifiers (one apply per presentation). No journal means a
 * reusable full-state copy. Model/voice/state replacement drops the journal outright. */
export interface ModifierCheckpoint<State = unknown> {
  capture(): void;
  restore(): State;
}

/**
 * A pure per-instance framebuffer transform. `apply` reads the (already scaled) voice
 * output in `fb` over `range` and rewrites it in place. Stateful modifiers declare a
 * `State` + `createState`; the compositor owns that state per-voice, resets it on voice
 * (re)spawn, and never persists it across voices.
 */
export interface ModifierDef<State = unknown> {
  id: string;
  name: string;
  category: ModifierCategory;
  /** Execution domain in the scoped voice runtime (not a gallery category). Stateful
   * time/noise fields advance once over full output; strip transforms are range-local.
   * Required so a new modifier must choose its clock/state ownership explicitly. */
  scopePolicy: 'full-output' | 'range-local';
  paramSpec: ParamSpec[];
  /** Build per-voice mutable state (accumulation buffers, RNG cursor). Sized to the model /
      the voice's pixel range; the range is stable for the voice's life. */
  createState?(model: PixelModel, range: PixelRange): State;
  /** Optional sparse undo contract; see ModifierCheckpoint. Not a serializable snapshot. */
  createCheckpoint?(state: State): ModifierCheckpoint<State>;
  apply(ctx: ModifierContext, params: ResolvedParams, fb: Framebuffer, range: PixelRange, state: State): void;
}

/**
 * One resolved link in a voice's modifier chain — the interface between the Effect resolver
 * and the engine. `params` are the device's authored values overlaid on the modifier
 * defaults; `bypass` disables the link (identity) without dropping it from the chain.
 * `modulations` (doc 10, S33) drives this link's params from modulation sources — the same
 * {@link Mapping} model + sampler as a play voice's `Voice.modulations`, sampled per-frame by
 * the chain runner just before `apply` (empty/undefined → params pass through unmodulated).
 * The Effect resolver populates it from the Effect's Control devices.
 */
export interface ResolvedModifier {
  modifierId: string;
  params: ResolvedParams;
  bypass?: boolean;
  modulations?: Mapping[];
  /** Dry/wet 0..1 over this link's range (effect chains): `out = dry + (wet − dry) × mix`,
      clamped to 0..1. Absent or 1 (with no envelope) = today's exact path. */
  mix?: number;
  /** Optional envelope over the voice's life that multiplies {@link mix} (effect chains). */
  envelope?: ModifierEnvelope;
}

/**
 * An ADSR over the host voice's life, in ms, shaping a modifier link's mix (S02). The clock is
 * the voice-local age ({@link ModifierContext.timeMs}), so the curve restarts with the voice:
 *
 *   0 → attackMs                 ramp 0 → 1
 *   → attackMs + decayMs         fall 1 → sustainLevel
 *   → lengthMs (if set)          hold at sustainLevel
 *   → lengthMs + releaseMs       fall from the level reached at lengthMs → 0, then stay 0
 *
 * `lengthMs` is the gate length from voice birth, like the amp envelope's gate (a release can
 * cut into the attack or decay). Absent, the envelope holds at sustain for the voice's life.
 * Evaluated by {@link modifierEnvelopeGain}.
 */
export interface ModifierEnvelope {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;
  releaseMs: number;
  /** Gate length (ms from voice birth) after which the release starts. Absent = hold forever. */
  lengthMs?: number;
}
