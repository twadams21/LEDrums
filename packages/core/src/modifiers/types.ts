/**
 * Effect modifiers — the "media effects" layer (Resolume analog: Grain / Bloom / Trail…).
 * A modifier is a pure, per-instance transform over a voice's rendered framebuffer, applied
 * BETWEEN the generator/pattern render and the compositor blend (see `compositor.ts` /
 * `generator-bridge.ts`). This registry mirrors `effects/registry.ts`: one deep module per
 * modifier, and the chain runner ({@link applyModifierChain}) is the only interface the
 * compositor sees.
 *
 * LOCKED model (doc 06 §C, 2026-07-02): modifiers are GRAPH NODES wired to a play node's
 * `mod` input; at voice spawn the graph resolves the play node's modifier closure into a
 * flat {@link ResolvedModifier}[] carried on the voice. The engine never sees graph topology
 * — the resolved chain is the interface. The graph layer arrives in S29; S28 builds the
 * engine seam (registry + chain runner + compositor hook + Trail) it hooks into.
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
  paramSpec: ParamSpec[];
  /** Build per-voice mutable state (accumulation buffers, RNG cursor). Sized to the model /
      the voice's pixel range; the range is stable for the voice's life. */
  createState?(model: PixelModel, range: PixelRange): State;
  apply(ctx: ModifierContext, params: ResolvedParams, fb: Framebuffer, range: PixelRange, state: State): void;
}

/**
 * One resolved link in a voice's modifier chain — the interface between graph resolution
 * (S29) and the engine. `params` are the node's authored values overlaid on the modifier
 * defaults; `bypass` disables the link (identity) without dropping it from the chain.
 * `modulations` (doc 10, S33) drives this link's params from modulation sources — the same
 * {@link Mapping} model + sampler as a play voice's `Voice.modulations`, sampled per-frame by
 * the chain runner just before `apply` (empty/undefined → params pass through unmodulated).
 * The graph layer (S34) populates it; before that the chain runs on the authored params.
 */
export interface ResolvedModifier {
  modifierId: string;
  params: ResolvedParams;
  bypass?: boolean;
  modulations?: Mapping[];
}
