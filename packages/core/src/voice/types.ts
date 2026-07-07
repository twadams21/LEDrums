/**
 * Pure data model for the trigger-graph / voice-bus lighting brain (ported from the
 * throwaway `apps/web/src/lib/trigger-lab/sim.ts`). No Node/DOM/IO — platform-agnostic
 * and unit-testable. The authored content is the {@link Show} aggregate; everything
 * else here is either authored sub-state or the engine-internal {@link Voice}.
 */
import type { ResolvedModifier } from '../modifiers/types';
import type { PlayType } from '../effects/vocabulary';
import type { CanvasScene } from '../canvas/types';
import type { Mapping } from './modulation';
import type { LfoSettings } from './lfo'; // S36

export type { PlayType };

export type { ResolvedModifier };

// ---- Enumerations -----------------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
/** What a switch routes on. `value` (gate/bands) is the canonical intensity-routing
    mode; the older `velocity` mode was folded into it and removed (web migrates any
    persisted `velocity` switch to `value`+bands). `section`/`beat` are count-based and
    unchanged. Mirrors the web sim's `SwitchOn`. */
export type SwitchOn = 'section' | 'beat' | 'value';
/** Sub-mode of a `value` switch: a single pass/block gate, or N value bands. */
export type ValueMode = 'gate' | 'bands';
export type Scope = 'drum' | 'kit' | 'hoop';
export type Polyphony = 'mono' | 'poly';

/** Named envelope shapes the editor seeds from (then reshapes into a curve). */
export type EnvKind = 'none' | 'decay' | 'rise' | 'pluck' | 'pulse' | 'custom';

// ---- Envelopes --------------------------------------------------------------

/** A breakpoint on an envelope curve — both axes 0..1 (t = life phase, v = level). */
export interface EnvPoint {
  t: number;
  v: number;
}

/** An easing family from the Resolume-familiar standard set. */
export type EaseFn =
  | 'linear'
  | 'quad'
  | 'cubic'
  | 'quart'
  | 'expo'
  | 'sine'
  | 'circ'
  | 'back'
  | 'bounce'
  | 'elastic';
/** Direction the family is applied in. `linear` is identical across all three. */
export type EaseDir = 'in' | 'out' | 'inOut';
/** A fully-specified ease: a family + direction. Evaluated by `ease()` in `easing.ts`. */
export interface EaseSpec {
  fn: EaseFn;
  dir: EaseDir;
}

/**
 * ADSR stage shape (times are fractions of the voice life 0..1). v2 (S23): the
 * attack rises to `attackLevel` (default 1) and each segment carries its own
 * {@link EaseSpec}. The legacy single `curve` tension is retained for migration
 * only — when a segment's `*Ease` is absent, sampling falls back to `curve` so
 * un-migrated shapes render byte-identically (see `adsrToPoints` / `migrateAdsr`).
 */
export interface AdsrShape {
  attack: number;
  decay: number;
  sustain: number; // level 0..1
  release: number;
  /** peak 0..1 the attack rises to, and the decay's starting level (default 1). */
  attackLevel?: number;
  /** legacy -1..1 segment tension; drives sampling only when a segment ease is absent. */
  curve?: number;
  attackEase?: EaseSpec;
  decayEase?: EaseSpec;
  releaseEase?: EaseSpec;
}

/** A per-parameter envelope: an editable curve + how strongly it sweeps (amount). */
export interface Envelope {
  kind: EnvKind;
  amount: number;
  points: EnvPoint[];
  /** ADSR decomposition, when authored via the ADSR editor (drives `points`). */
  adsr?: AdsrShape;
}

/** A param value: numbers/booleans plus `string` for enum choices (e.g. radial-wash
    `mode`) and any static-colour param stored as a `'#rrggbb'` hex string. Envelopes only
    sweep `number` params; strings flow through the engine untouched (S18). */
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;
/** param key → envelope driving it. */
export type EnvMap = Record<string, Envelope>;

// ---- Effects + presets + buses ---------------------------------------------

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Allowed values for an `enum` param (rendered as a Select). */
  options?: string[];
  default: ParamValue;
  /** a number param an envelope can sweep over the voice's life. */
  envable?: boolean;
}

export interface EffectDef {
  id: string;
  name: string;
  /**
   * The effect is GENERATOR-BACKED: a voice hosting it delegates rendering to the
   * {@link EffectGenerator} registered under this id (see the compositor bridge). Every
   * selectable effect is generator-backed since the legacy per-pixel pattern path was
   * retired (Effects Library v2, U3); the field stays optional only for structural
   * compatibility with authored/persisted shapes.
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

export type BlockKind = 'play' | 'effect' | 'all' | 'random' | 'sequence' | 'switch' | 'chance' | 'toggle' | 'delay';
/**
 * `modifier` is NOT a block kind — it takes no part in trigger-flow evaluation (it never
 * fires children). It is a media-effects node wired to a play node's `mod` input handle;
 * at voice spawn its closure is resolved into `PlayAction.modifiers` (see
 * `resolveModifierChain` in `modifier-graph.ts`). Kept out of {@link BlockKind} so the
 * block-tree types (web `Block` union, `treeToGraph`) are unaffected.
 *
 * `envelope` (doc 10, S34) is a MODULATION SOURCE node — like `modifier` it is inert in
 * trigger-flow eval (fires no children) and takes no flow/mod input; it carries a shape and
 * wires from its output into a play/modifier node's exposed `param:<key>` input rows, where
 * graph resolution turns it into a {@link import('./modulation').Mapping}. `lfo`/`cc` join it
 * as source kinds in S36/S37.
 */
export type RandomDistribution = 'linear' | 'gaussian' | 'exponential' | 'logarithmic' | 'triangular' | 'beta' | 'stepped';
export type NoteModMode = 'gate' | 'velocity';

export type NodeKind =
  | 'trigger'
  | BlockKind
  | 'effect'
  | 'modifier'
  | 'scope'
  | 'output'
  | 'envelope'
  | 'lfo'
  | 'cc'
  | 'note'
  | 'osc'
  | 'randomMod'; // S36 'lfo' + S37 'cc'

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
  /**
   * The play node's TYPE (D3) — the same seven-bucket taxonomy the gallery collections
   * use (one vocabulary module, `effects/vocabulary.ts`), so gallery grouping and node
   * types can never drift. Authoring-layer taxonomy only: the engine stays uniform
   * underneath (everything renders through the one `EffectGenerator` seam). Optional for
   * persisted back-compat — hydrate infers a missing value from `effectId` via
   * `playTypeForEffect` (total mapping).
   */
  playType?: PlayType;
  /**
   * Authored canvas-scene document id — meaningful only when `playType === 'canvas'`.
   * A canvas node resolves a SCENE where a hosted node resolves a generator id; the
   * voice hosts it as `generatorId = canvasEffectId(canvasScene)` (see `canvas/ids.ts`),
   * so the compositor/bridge dispatch is untouched.
   */
  canvasScene?: string;
  presetId: string;
  /** layer/bus override for this node ('' → the effect's default bus). */
  busId: string;
  /**
   * Per-play-node scope target. Encoding:
   *   drum target  = drumId, e.g. `"kick"`
   *   hoop target  = `"<drumId>#<hoopIndex>"`, e.g. `"tom1#2"`
   * Absent/empty = auto (scope resolves against the firing/source drum).
   * Back-compat: graphs persisted before targetId default to undefined.
   */
  targetId?: string;
  params: ParamValues;
  env: EnvMap;
  // modifier (only meaningful when kind === 'modifier')
  /** Which {@link ModifierDef} this modifier node applies (registry id). Optional +
      additive — only modifier nodes carry it; graphs authored before modifiers lack it.
      An empty/unknown id resolves to nothing (the chain runner skips it, never throws). */
  modifierId?: string;
  /** Modifier bypass: when true the resolved link is identity (kept in the chain so its
      per-voice state slot survives toggling). Optional; defaults to not-bypassed. */
  bypass?: boolean;
  // modulation targets (doc 10, S34) — meaningful on play + modifier nodes
  /** Ordered list of params this node has EXPOSED as modulation targets (doc 10). Empty /
      absent by default; the target Inspector's "Add parameter" appends one. Each entry
      renders as its own node-face row with a `param:<param>` input handle scoped to
      modulation sources. The rows are the exposed surface; the actual mappings live on the
      incoming `param:<key>` edges (one edge = one mapping), so an exposed-but-unwired param
      is a row with no contribution. */
  modInputs?: { param: string }[];
  // lfo source (doc 10, S36) — only meaningful when kind === 'lfo'. Optional + additive; unset
  // falls back to defaults in `nodeModSource` so a freshly-wired LFO still animates.
  lfo?: LfoSettings; // S36
  // cc source (S37) — meaningful only on a `cc` modulation-source node
  /** MIDI controller number this CC node reads (0..127). Controller 0 is reserved for
      section recall and rejected in the editor. Absent → 1 (nodeModSource falls back). */
  ccController?: number; // S37
  /** MIDI channel filter (1..16), or `null` for omni (any channel). Absent → omni. */
  ccChannel?: number | null; // S37
  /** Which live input drives this CC/controller source: MIDI Control Change (default) or an OSC
      address. Absent → 'midi' (back-compat: graphs authored before OSC modulation). */
  ccSource?: 'midi' | 'osc';
  /** OSC address this source reads a 0..1 value from when {@link ccSource} is 'osc'. Absent → ''
      (⇒ `sampleOsc` neutral until an address is set). */
  oscAddress?: string;
  /** MIDI note this note modulation source reads (0..127). Absent → 60. */
  noteNumber?: number;
  /** MIDI channel filter (1..16), or `null` for omni. Absent → omni. */
  noteChannel?: number | null;
  /** Whether a note source outputs held gate level or the last note-on velocity. */
  noteMode?: NoteModMode;
  /** Release time in milliseconds for gate mode after note-off. */
  noteReleaseMs?: number;
  /** Distribution used by a random modulation source. Absent → linear back-compat. */
  randomDistribution?: RandomDistribution;
  /** Number of quantization steps when randomDistribution === 'stepped'. */
  randomSteps?: number;
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
  // delay (only meaningful on the `delay` node)
  /** `'time'` → fire after an absolute `ms` offset; `'beats'` → resolve `division` against
      the current bpm at enqueue time. */
  delayMode: 'time' | 'beats';
  /** Absolute delay in milliseconds (used when `delayMode === 'time'`). */
  ms: number;
  /** Musical division string (used when `delayMode === 'beats'`). Full set defined by
      `DELAY_DIVISIONS` in `delay.ts`: `'1/4'|'1/8'|'1/16'` plus dotted + triplet variants. */
  division: string;
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
  /** target handle this edge lands on. `undefined`/`'in'` = the node's trigger-flow input
      (back-compat). `'mod'` = a play/modifier node's modifier input (a modifier-chain wire).
      `` `param:<key>` `` (doc 10, S34) = a modulation wire landing on the target's exposed
      param row `<key>` — one such edge IS one {@link import('./modulation').Mapping} onto that
      param, carrying its own `amount`/`invert`/`rangeMin`/`rangeMax` below. */
  toPort?: 'in' | 'mod' | `param:${string}`;
  // per-mapping settings (doc 10, S34) — meaningful ONLY on a `param:<key>` modulation edge.
  // Edited target-side (the target node's Inspector), one entry per incoming wire. Absent →
  // the resolver's defaults (amount 1, no invert, range = the target param spec's min/max).
  /** modulation depth 0..1 (default 1). */
  amount?: number;
  /** flip the source signal (1 − s) before scaling into the range (default false). */
  invert?: boolean;
  /** low bound the source maps into (default = target param spec min). */
  rangeMin?: number;
  /** high bound the source maps into (default = target param spec max). */
  rangeMax?: number;
}

export interface TriggerGraph {
  /** Trigger graph schema generation. Missing/2 = legacy Gen2; 3 = terminal Output anchor. */
  version?: 3;
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
  /**
   * User-authored canvas scene documents. The engine registers these into the pure
   * canvas registry on `setShow()` so `canvas:<sceneId>` resolves through the normal
   * `EffectGenerator` lookup (no compositor fork, locked decision 7).
   */
  canvasScenes?: CanvasScene[];
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
 * A live light instance: a hosted generator + resolved params + envelope playing on a
 * bus. Object-pooled inside the engine; `active` marks pool occupancy. Identity for
 * cross-frame references (toggle latching, voice-stealing) is the string `id`.
 */
export interface Voice {
  /** Pool occupancy flag — inactive voices are reuse candidates. */
  active: boolean;
  /** Stable identity for latch/stop references (`v${seq}`). */
  id: string;
  effectId: string;
  /** The spawning play node's type (D3) — carried for diagnostics/UI; the render path
   *  never branches on it (the engine is uniform under the taxonomy). */
  playType?: PlayType;
  /** Canvas-scene doc id when this voice hosts a canvas effect (`playType 'canvas'`). */
  canvasScene?: string;
  busId: string;
  mode: PlayMode;
  scope: Scope;
  /** Raw targetId from the play node — resolved to a pixel range by the compositor.
   *  Encoding: drum = drumId; hoop = `"<drumId>#<hoopIndex>"`. Absent = auto. */
  targetId?: string;
  sourceDrumId: string | null;
  /** Normalized hit velocity 0..1 captured at spawn — drives a hosted generator's
   * synthetic trigger (intensity / wash falloff / particle spread). */
  velocity: number;
  /**
   * Per-trigger RNG seed (item C): derived at spawn from the pool's monotonic voice
   * counter via {@link deriveSeed}, so each fire of a random-look effect (confetti…)
   * looks different, yet identical input sequences reproduce byte-identically —
   * deterministic given the seed, never ambient `Math.random`. Passed to
   * `EffectGenerator.createState(model, seed)`.
   */
  seed: number;
  /**
   * Hosted effect generator id (`null` only for a never-resolved slot). The compositor
   * renders that {@link EffectGenerator} into a scratch framebuffer and composites it into
   * the frame scaled by `level*deckGain`, masked to the drum range for `scope==='drum'`.
   * The generator owns its own colour and brightness.
   */
  generatorId: string | null;
  /**
   * Per-voice generator state (from `EffectGenerator.createState`) — accumulation
   * buffers, seeded RNG cursors, particle lists. Built lazily on first render and
   * persisted across frames for the voice's life; reset to `null` when the pool slot
   * is reused. Opaque to everything but the hosted generator.
   */
  genState: unknown;
  /**
   * Resolved modifier chain (S28+): pure framebuffer transforms applied in order between
   * this voice's render and the compositor blend (see `modifiers/chain.ts`). Resolved from
   * graph topology at spawn (S29); `undefined`/empty → the voice takes the unchanged
   * zero-alloc hot path. The engine never sees graph topology — this flat chain is the seam.
   */
  modifiers?: ResolvedModifier[];
  /**
   * Per-voice, per-modifier mutable state (accumulators, ring buffers), parallel to
   * `modifiers`. Built lazily by the chain runner and persisted for the voice's life; reset
   * to `undefined` on pool-slot reuse so a retriggered voice starts clean (mirrors
   * `genState` lifecycle).
   */
  modState?: unknown[];
  /**
   * Resolved modulation mappings onto this voice's effect params (doc 10). Populated from
   * graph topology at spawn (S34); `undefined`/empty → params take their unmodulated value.
   * The per-frame param sweep (`applyEffectiveParams`) sums each param's contributions and
   * clamps to the spec range. Same {@link Mapping} model + sampler as the modifier chain's
   * `ResolvedModifier.modulations` — one model, two carriers.
   */
  modulations?: Mapping[];
  /** resolved param snapshot at spawn (live params for the frame derive from this). */
  params: ParamValues;
  /**
   * Per-frame effective params (envelopes + tempo-sync applied). A reused scratch
   * object owned by the pool slot — the engine refills it each tick before the
   * compositor reads it, so the hot path stays allocation-free.
   */
  liveParams: ParamValues;
  /** The spawning effect's param specs (by reference) — drives modulation ranges. */
  specs: ParamSpec[];
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
