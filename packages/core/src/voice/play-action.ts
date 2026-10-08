/**
 * The play action — the seam between authored content and the voice pool. The one resolver
 * (`effect-chain/resolver.ts`) turns an Effect plus a trigger context into a {@link PlayAction};
 * `VoicePool.spawn` turns that into a live voice. Everything below this type (voice pool,
 * envelope tick, effective-param sampling, generator bridge, modifier chain runner, compositor)
 * is independent of how the action was produced. A few fields (`mixInputs`, `originNodeId`,
 * `supersedePriorVoice`, `playType`) are carried for the unchanged voice pool / compositor and
 * are not set by the Effect path.
 */
import type {
  EaseSpec,
  ParamValues,
  PlayMode,
  PlayType,
  ResolvedModifier,
  Scope,
  SpliceConfig,
} from './types';
import type { Mapping } from './modulation';
import type { BlendMode } from '../color/blend';
import type { CurveValue } from '../model/curve';

export interface PlayAction {
  kind: 'play';
  effectId: string;
  /** Taxonomy only; carried verbatim to the spawned voice, nothing on the render path branches
      on it. */
  playType?: PlayType;
  /** Canvas-scene doc id — the pool hosts it as a `canvas:<sceneId>` generator id, so the
      compositor/bridge dispatch stays untouched. */
  canvasScene?: string;
  mode: PlayMode;
  scope: Scope;
  /** Scope target (a drum id, or `drum#hoop` list) the compositor resolves to a pixel range. */
  targetId?: string;
  /** layer/bus override ('' → the effect's default bus). */
  busId: string;
  params: ParamValues;
  /** Authored amplitude-over-life curve, carried verbatim to the spawned voice (S6b). Absent →
      the voice takes its dwell from the effect's declared life param. */
  lifeEnvelope?: CurveValue;
  /** Resolved modifier chain, carried verbatim to the spawned voice. */
  modifiers?: ResolvedModifier[];
  /** Resolved modulation mappings onto the effect params, carried verbatim to the voice. */
  modulations?: Mapping[];
  mixBlendMode?: BlendMode;
  mixInputs?: MixInputDraft[];
  /** Resolved splice layout (bands + chase + tints) for a Splice / Slice generator. Carried
      verbatim to the voice; the compositor reads it directly. */
  splice?: SpliceConfig;
  /** One draft per NON-BLANK splice slot, index-aligned with `splice.inputBySlot`. */
  spliceInputs?: MixInputDraft[];
  /**
   * Envelope override, in milliseconds. When present the voice takes these instead of the
   * hosting effect's attack/sustain/release. Absent → the effect's own envelope.
   */
  attackMs?: number;
  sustainMs?: number;
  /** Loop: the envelope's whole cycle (attack + sustain + release, ms). The voice repeats it — and
      its generator restarts with fresh content each cycle — until released. */
  loopMs?: number;
  releaseMs?: number;
  /** Curve the attack rises on — carried to the voice so its ramp is eased, and to the splice
      config so a per-unit attack uses the same shape. */
  attackEase?: EaseSpec;
  /** Origin tag for origin-keyed voice liveness (see `VoicePool.isLayerLive`). */
  originNodeId?: string;
  /** Release the prior live voice at the same `(pad, originNodeId)` before spawning — see
      `VoicePool.spawn`. */
  supersedePriorVoice?: boolean;
  /**
   * Real-time width of {@link lifeEnvelope}'s x axis, in ms. Absent → the pool derives it from
   * the effect's declared life. The Effect path sets it so an amp envelope's decay is timed in
   * its own milliseconds rather than the hosted generator's life param.
   */
  lifeSpanMs?: number;
  /** The authored Effect id this action plays (see {@link Voice.chainEffectId}). */
  chainEffectId?: string;
  /** Which hit of its Effect this fire is (see {@link Trigger.hit}). */
  hitIndex?: number;
  blend?: BlendMode;
  opacity?: number;
  layerOrder?: number;
  /** Explicit multi-target list (see {@link Voice.targets}). */
  targets?: string[];
  via: string;
  latchKey: string | null;
}

/** A play action before its provenance (`via`) and latch key are attached — the shape a splice
    member carries. */
export type PlayDraft = Omit<PlayAction, 'kind' | 'via' | 'latchKey'> & { originNodeId?: string };
export type MixInputDraft = PlayDraft & { opacity: number; originNodeId: string };
