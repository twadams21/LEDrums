/**
 * Pure data model for the trigger-graph / voice-bus lighting brain (ported from the
 * throwaway `apps/web/src/lib/trigger-lab/sim.ts`). No Node/DOM/IO — platform-agnostic
 * and unit-testable. The authored content is the {@link Show} aggregate; everything
 * else here is either authored sub-state or the engine-internal {@link Voice}.
 */

// ---- Enumerations -----------------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
export type SwitchOn = 'velocity' | 'section' | 'beat';
export type Scope = 'drum' | 'kit';
export type Polyphony = 'mono' | 'poly';

/** The abstract procedural visual an effect demonstrates in the pixel renderer. */
export type Pattern =
  | 'flash'
  | 'chase'
  | 'sparkle'
  | 'ripple'
  | 'swirl'
  | 'aurora'
  | 'drift'
  | 'radial'
  | 'haze'
  | 'strobe';

export const PATTERNS: readonly Pattern[] = [
  'flash',
  'chase',
  'sparkle',
  'ripple',
  'swirl',
  'aurora',
  'drift',
  'radial',
  'haze',
  'strobe',
];

/** Named envelope shapes the editor seeds from (then reshapes into a curve). */
export type EnvKind = 'none' | 'decay' | 'rise' | 'pluck' | 'pulse' | 'custom';

// ---- Envelopes --------------------------------------------------------------

/** A breakpoint on an envelope curve — both axes 0..1 (t = life phase, v = level). */
export interface EnvPoint {
  t: number;
  v: number;
}

/** ADSR stage shape (times are fractions of the voice life 0..1). */
export interface AdsrShape {
  attack: number;
  decay: number;
  sustain: number; // level 0..1
  release: number;
  curve: number; // -1..1 segment tension
}

/** A per-parameter envelope: an editable curve + how strongly it sweeps (amount). */
export interface Envelope {
  kind: EnvKind;
  amount: number;
  points: EnvPoint[];
  /** ADSR decomposition, when authored via the ADSR editor (drives `points`). */
  adsr?: AdsrShape;
}

export type ParamValue = number | boolean;
export type ParamValues = Record<string, ParamValue>;
/** param key → envelope driving it. */
export type EnvMap = Record<string, Envelope>;

// ---- Effects + presets + buses ---------------------------------------------

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: ParamValue;
  /** a number param an envelope can sweep over the voice's life. */
  envable?: boolean;
}

export interface EffectDef {
  id: string;
  name: string;
  pattern: Pattern;
  busId: string;
  scope: Scope;
  params: ParamSpec[];
  attackMs: number;
  /** one-shot dwell at full before release. */
  sustainMs: number;
  releaseMs: number;
}

export interface Preset {
  id: string;
  name: string;
  effectId: string;
  params: ParamValues;
}

export interface Bus {
  id: string;
  name: string;
  polyphony: Polyphony;
  crossfadeMs: number;
}

// ---- Trigger graph (freeform node wiring) -----------------------------------

export type BlockKind = 'play' | 'all' | 'random' | 'sequence' | 'switch' | 'chance' | 'toggle';
export type NodeKind = 'trigger' | BlockKind;

/**
 * A node in the freeform trigger graph. Carries every kind's fields (only the ones
 * for its `kind` are meaningful) so editors and eval need no narrowing.
 */
export interface GraphNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  // play
  mode: PlayMode;
  scope: Scope;
  effectId: string;
  presetId: string;
  /** layer/bus override for this node ('' → the effect's default bus). */
  busId: string;
  params: ParamValues;
  env: EnvMap;
  linked: boolean;
  // random
  noRepeat: boolean;
  // switch
  on: SwitchOn;
  // chance
  p: number;
}

export interface GraphEdge {
  id: string;
  from: string; // source node id (output port)
  to: string; // target node id (input port)
}

export interface TriggerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---- Section snapshots ------------------------------------------------------

export interface Section {
  id: string;
  name: string;
  /** which effect each bus loops when the section loads (null = silent). */
  looks: Record<string, string | null>;
}

// ---- Show aggregate (the authored content) ----------------------------------

/**
 * The authored content the engine runs: buses, per-pad trigger graphs (keyed by
 * padKey `"drumId:zone"`), section snapshots, and the effect/preset registries.
 */
export interface Show {
  buses: Bus[];
  /** padKey "drumId:zone" → the graph fired when that pad is hit. */
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
}

export function emptyShow(): Show {
  return { buses: [], graphs: {}, sections: [], effects: [], presets: [] };
}

/** Build the padKey a graph is registered under for a (drum, zone) pad. */
export function padKey(drumId: string, zone: string): string {
  return `${drumId}:${zone}`;
}

// ---- Voices (live instances — engine-internal, NOT part of the seam) --------

export type VoicePhase = 'attack' | 'sustain' | 'release';

/**
 * A live light instance: a pattern + resolved params + envelope playing on a bus.
 * Object-pooled inside the engine; `active` marks pool occupancy. Identity for
 * cross-frame references (toggle latching, voice-stealing) is the string `id`.
 */
export interface Voice {
  /** Pool occupancy flag — inactive voices are reuse candidates. */
  active: boolean;
  /** Stable identity for latch/stop references (`v${seq}`). */
  id: string;
  effectId: string;
  pattern: Pattern;
  busId: string;
  mode: PlayMode;
  scope: Scope;
  sourceDrumId: string | null;
  /** resolved param snapshot at spawn (live params for the frame derive from this). */
  params: ParamValues;
  /**
   * Per-frame effective params (envelopes + tempo-sync applied). A reused scratch
   * object owned by the pool slot — the engine refills it each tick before the
   * compositor reads it, so the hot path stays allocation-free.
   */
  liveParams: ParamValues;
  /** The spawning effect's param specs (by reference) — drives envelope ranges. */
  specs: ParamSpec[];
  env: EnvMap;
  attackMs: number;
  sustainMs: number;
  releaseMs: number;
  phase: VoicePhase;
  level: number;
  bornAtMs: number;
  releaseAtMs: number | null;
  releaseFromLevel: number;
  via: string;
  deckGain: number;
}
