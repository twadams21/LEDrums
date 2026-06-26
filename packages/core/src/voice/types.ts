/**
 * Pure data model for the trigger-graph / voice-bus lighting brain (ported from the
 * throwaway `apps/web/src/lib/trigger-lab/sim.ts`). No Node/DOM/IO — platform-agnostic
 * and unit-testable. The authored content is the {@link Show} aggregate; everything
 * else here is either authored sub-state or the engine-internal {@link Voice}.
 */

// ---- Enumerations -----------------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
/** What a switch routes on. `value` (gate/bands) is the canonical intensity-routing
    mode; the older `velocity` mode was folded into it and removed (web migrates any
    persisted `velocity` switch to `value`+bands). `section`/`beat` are count-based and
    unchanged. Mirrors the web sim's `SwitchOn`. */
export type SwitchOn = 'section' | 'beat' | 'value';
/** Sub-mode of a `value` switch: a single pass/block gate, or N value bands. */
export type ValueMode = 'gate' | 'bands';
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
  /**
   * When set, this effect is GENERATOR-BACKED: a voice hosting it delegates rendering
   * to the legacy {@link EffectGenerator} registered under this id (see the compositor
   * bridge) instead of sampling `pattern`. `pattern` is ignored for such effects.
   * Undefined → the lightweight per-pixel pattern fast path.
   */
  generatorId?: string;
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

// ---- Trigger source (what fires a trigger graph) ----------------------------

/**
 * What input fires a trigger graph — declared on the graph's `trigger` node. A tagged
 * union: `drum` is the implicit padKey binding (`"drumId:zone"`) made explicit; `midi`
 * (a note OR a CC) and `osc` (an address) are direct bindings for AUTHORED graphs with
 * no physical drum zone. MIDI channel + OSC host/namespace live on the patch device,
 * NOT here. Structurally IDENTICAL to the web sim's `TriggerSource` (the show-builder
 * passes graphs through by structural typing — the shapes must stay byte-identical).
 */
export type TriggerSource =
  | { kind: 'drum'; drumId: string; zone: string }
  | { kind: 'midi'; note?: number; cc?: number }
  | { kind: 'osc'; address: string };

/**
 * A raw fire from one of the three trigger sources, in that source's native units.
 * Normalized to the trigger's 0..1 value by {@link normalizeTriggerValue} — the single
 * value the switch `value` mode (gate/bands) routes on, identical across all sources.
 * Structurally IDENTICAL to the web sim's `TriggerFire`.
 */
export type TriggerFire =
  | { kind: 'drum'; velocity: number } // Sensory Percussion velocity, already 0..1
  | { kind: 'midi'; value: number } //   MIDI note-on velocity OR CC value, 0..127
  | { kind: 'osc'; arg: number }; //     OSC float argument (clamped to 0..1)

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Normalize a raw fire to the trigger's 0..1 value — the ONE seam every source feeds so
 * they route through the switch `value` mode identically. Pure: drum velocity passes
 * through (already 0..1), MIDI note-velocity / CC divides by 127, OSC arg is taken as-is;
 * all clamped to 0..1. Byte-identical to the web sim's `normalizeTriggerValue` so the two
 * value pipelines can never drift.
 */
export function normalizeTriggerValue(fire: TriggerFire): number {
  switch (fire.kind) {
    case 'drum':
      return clampUnit(fire.velocity);
    case 'midi':
      return clampUnit(fire.value / 127);
    case 'osc':
      return clampUnit(fire.arg);
  }
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
  /** value-switch sub-mode (only meaningful when on==='value'). */
  valueMode: ValueMode;
  /** gate cutoff 0..1 (value-switch gate). */
  threshold: number;
  /** gate direction: false → pass when value ≤ threshold; true → pass when value > threshold. */
  invert: boolean;
  /** ascending band cutoffs 0..1 (value-switch bands). N bands = N−1 cutoffs; the
      last band is "the rest" (value above the final cutoff). */
  bands: number[];
  // chance
  p: number;
  // trigger (only meaningful on the `trigger` node)
  /** What input fires this graph (the explicit binding). Optional + additive — graphs
      authored before the source model carry none. Resolution lives in a later slice;
      core only mirrors the field so web graphs pass through structurally. */
  source?: TriggerSource;
}

export interface GraphEdge {
  id: string;
  from: string; // source node id (output port)
  to: string; // target node id (input port)
  /** source handle id this edge leaves from. undefined = the node's default single
      output (back-compat). For a value+bands switch, band i's handle is `band-${i}`. */
  fromPort?: string;
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

// ---- Setlist (song → section → per-drum graph slots) -----------------------

/**
 * padKey "drumId:zone" → ordered list of graph keys (null = empty slot). Keyed per
 * PAD (not per drum), so each zone of a drum carries its own slot graphs. Each key
 * references a graph in `Show.graphs`; stacked non-null keys are fired as layers on
 * a hit to that pad.
 */
export type SlotRefs = Record<string, (string | null)[]>;

/** One section in a song's arrangement: per-pad ordered graph-key slots. */
export interface SongSection {
  id: string;
  name: string;
  slots: SlotRefs;
}

/**
 * An authored song: a named sequence of arrangement sections. Structural
 * mirror of the web's `setlist.Song` so `show-builder` assembles by pass-through.
 */
export interface ShowSong {
  id: string;
  name: string;
  sections: SongSection[];
}

// ---- Show aggregate (the authored content) ----------------------------------

/**
 * The authored content the engine runs: buses, per-pad trigger graphs (keyed by
 * padKey `"drumId:zone"`), section snapshots, the effect/preset registries, and
 * the optional setlist arrangement (songs → sections → per-drum graph slots).
 */
export interface Show {
  buses: Bus[];
  /** padKey "drumId:zone" → the graph fired when that pad is hit. */
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
  /**
   * Authored arrangement: songs with per-section slot grids keyed per pad by
   * padKey "drumId:zone". Each slot holds a graph key into `Show.graphs` (null =
   * empty). When an active section is set, a hit fires the non-null slot graphs for
   * THAT pad (layered, in slot order) instead of the flat `graphs[padKey(drumId,
   * zone)]` fallback — so each zone fires its own graphs.
   */
  songs?: ShowSong[];
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
  /** Normalized hit velocity 0..1 captured at spawn — drives a hosted generator's
   * synthetic trigger (intensity / wash falloff / particle spread). */
  velocity: number;
  /**
   * Hosted legacy-effect generator id, or `null` for a pattern voice. When set, the
   * compositor renders that {@link EffectGenerator} into a scratch framebuffer and
   * composites it into the frame scaled by `level*deckGain`, masked to the drum range
   * for `scope==='drum'`. The generator owns its own colour, so the voice `hue`/
   * `brightness` pattern handling is bypassed (brightness lives inside the generator).
   */
  generatorId: string | null;
  /**
   * Per-voice generator state (from `EffectGenerator.createState`) — accumulation
   * buffers, seeded RNG cursors, particle lists. Built lazily on first render and
   * persisted across frames for the voice's life; reset to `null` when the pool slot
   * is reused. Opaque to everything but the hosted generator.
   */
  genState: unknown;
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
