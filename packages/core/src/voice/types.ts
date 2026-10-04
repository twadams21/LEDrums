import type { AudioBand } from './audio-features';
import type { Vec3 } from '../math';
import type { GeometryState } from './geometry-state';
/**
 * Pure data model for the voice-bus lighting brain. No Node/DOM/IO — platform-agnostic and
 * unit-testable. The runtime content is the {@link Show} aggregate; everything else here is
 * either authored sub-state or the engine-internal {@link Voice}.
 */
import type { CurveValue } from '../model/curve';
import type { ResolvedModifier } from '../modifiers/types';
import type { PlayType } from '../effects/vocabulary';
import type { CanvasScene } from '../canvas/types';
import type { BlendMode } from '../color/blend';
import type { Mapping } from './modulation';
import type { LfoSettings } from './lfo'; // S36
import type { CellPlay, Effect, ModifierDevice } from '../effect-chain/types';
import type { InputMapping } from '../effect-chain/input-mappings';

export type { PlayType };

export type { ResolvedModifier };

// ---- Enumerations -----------------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
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

export interface Bus {
  id: string;
  name: string;
  polyphony: Polyphony;
  crossfadeMs: number;
}

// ---- Trigger source (what an input binding listens to) ------------------------

/**
 * An input source a binding listens to. A tagged union: `drum` is a pad (`"drumId:zone"`);
 * `midi` (a note OR a CC) and `osc` (an address) are raw input addresses, as a Cue Effect's
 * source carries them. MIDI channel + OSC host/namespace live on the patch device, NOT here.
 * The binding-claims guard checks a source write with `sourceBindingRejections`.
 */
export type TriggerSource =
  | { kind: 'drum'; drumId: string; zone: string }
  | { kind: 'midi'; note?: number; cc?: number }
  | { kind: 'osc'; address: string };

/**
 * A raw fire from one of the three trigger sources, in that source's native units.
 * Normalized to the trigger's 0..1 value by {@link normalizeTriggerValue} — the velocity an
 * Effect fires with, identical across all sources.
 */
export type TriggerFire =
  | { kind: 'drum'; velocity: number } // Sensory Percussion velocity, already 0..1
  | { kind: 'midi'; value: number } //   MIDI note-on velocity OR CC value, 0..127
  | { kind: 'osc'; arg: number }; //     OSC float argument (clamped to 0..1)

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Normalize a raw fire to the trigger's 0..1 value — the ONE seam every source feeds. Pure:
 * drum velocity passes through (already 0..1), MIDI note-velocity / CC divides by 127, OSC arg
 * is taken as-is; all clamped to 0..1.
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

// ---- Modulation-source settings --------------------------------------------

export type RandomDistribution = 'linear' | 'gaussian' | 'exponential' | 'logarithmic' | 'triangular' | 'beta' | 'stepped';
export type NoteModMode = 'gate' | 'velocity';

// ---- Splice (one node, many bands) ------------------------------------------

/**
 * What a `splice` node cuts up. The node's own scope (kit / drum / hoop, narrowed by any
 * upstream Scope) decides WHICH pixels it owns; this decides how those pixels are divided:
 * - `'hoop'`   — each hoop is cut into `count` splices, so a chase reads as a spin AROUND
 *                every ring at once (the default: hoops are the kit's natural circles).
 * - `'drum'`   — each drum's whole pixel run is cut into `count`, so a splice spans hoops.
 * - `'scope'`  — the owned range is cut into `count` once, end to end.
 */
export type SplicePartition = 'hoop' | 'drum' | 'scope';

/**
 * How a splice node's content moves. All three read the same rate (a musical division or free
 * milliseconds) and the same direction; they differ in WHAT moves and whether it glides.
 * - `'off'`     — bands hold still.
 * - `'step'`    — the CONTENT rotates one splice per interval; band geometry stays put (a
 *                 chase: content hops slot to slot, so the increment is always one splice).
 * - `'smooth'`  — the band GEOMETRY slides continuously around the range, wrapping at the end
 *                 (a spin: the whole cut pattern rotates, one lap per interval).
 * - `'stagger'` — the band GEOMETRY jumps by an authored PIXEL increment each interval: the
 *                 same material walking round the hoop, but in discrete hops rather than a
 *                 glide, and at a step size independent of how wide the splices are.
 */
export type SpliceChaseMode = 'off' | 'step' | 'smooth' | 'stagger';

/**
 * The order the partition units start moving in, when a splice node offsets its motion across
 * them (see {@link SpliceConfig.offsetMs}). "Unit" is a hoop under the `'hoop'` partition and a
 * drum under `'drum'` — so on a whole drum this is the order the HOOPS fire in.
 * - `'up'`         — hoop 1 first, climbing the drum.
 * - `'down'`       — the top hoop first, descending.
 * - `'outside-in'` — the two outer hoops first, working inward (1, N, 2, N−1, …).
 * - `'random'`     — a seeded shuffle: stable for the voice's life, different per seed.
 */
export type SpliceOrder = 'up' | 'down' | 'outside-in' | 'random';

/**
 * What a new hit does to a splice's motion.
 * - `'restart'`    — the hit puts the chase/spin/stagger back to its starting position, so
 *                    every hit reads as a fresh gesture. (The original behaviour.)
 * - `'continuous'` — the motion runs off a free clock, so a hit picks up wherever the last
 *                    one left off and the movement never visibly resets. Every voice from
 *                    this node shares that clock, which is what keeps successive hits in
 *                    phase with each other rather than each starting its own timeline. The
 *                    clock keeps running while the kit is DARK, so a hit after a long gap
 *                    lands wherever the movement would have travelled unseen.
 * - `'latched'`    — like continuous, except the movement only advances while the lights are
 *                    actually up: it freezes at the position it reached as the fade ended,
 *                    and the next hit carries on from exactly there. The visible motion is
 *                    therefore continuous ACROSS the silence rather than through it.
 */
export type SpliceMotionMode = 'restart' | 'continuous' | 'latched';

/**
 * What a partition unit does while it waits for its turn in a cascade offset.
 * - `'lit'`  — it shows its resting cut, standing still until the movement reaches it. The
 *              kit is fully lit from the first frame and the cascade reads as motion.
 * - `'dark'` — it emits nothing at all until its turn comes, so the light itself travels
 *              across the hoops (or drums) rather than the movement travelling through
 *              already-lit ones. Once lit it stays up for the rest of the voice.
 * - `'fade'`  — as `'dark'`, but it fades UP over the attack time as its turn arrives and then
 *               stays lit. Without this only the first arrival ever fades, because the fade a
 *               `'dark'` unit appears to have is really the VOICE's global attack — which is
 *               long finished by the time the second one is revealed.
 * - `'pulse'` — as `'fade'`, and it also holds and fades back OUT as the cascade reaches it,
 *               then goes dark again: a pulse of light travelling across the kit rather than
 *               a leading edge that leaves everything lit behind it.
 * Timed against the VOICE's age, not the motion clock, so it means the same thing under all
 * three {@link SpliceMotionMode}s — including `continuous`, whose clock has no zero to
 * measure a delay from.
 */
export type SpliceWaitMode = 'lit' | 'dark' | 'fade' | 'pulse';

/**
 * One splice — what renders inside one band of the partition. Every field is optional
 * because "blank" is a legitimate, authorable state:
 *   effect + colour → the effect, tinted toward the colour
 *   effect, no colour → the effect, untouched
 *   colour, no effect → a flat fill of that colour (hosted by the `solid-colour` generator)
 *   neither, or `muted` → blank; the band renders nothing and whatever is underneath shows.
 */
export interface SpliceDef {
  /** `#rrggbb`, or null/absent for "no colour". */
  color?: string | null;
  /** Effect id from the same registry the gallery lists. Absent = no effect. */
  effectId?: string;
  /** Canvas-scene doc id, when this splice hosts a canvas effect. */
  canvasScene?: string;
  /** Param overrides for {@link effectId} (defaults fill the rest). */
  params?: ParamValues;
  /** Blank this splice without losing what is authored on it. */
  muted?: boolean;
}

/**
 * The resolved splice layout carried on a play action / voice: everything the compositor
 * needs to lay bands out and move them. Built once at fire time — the bpm-derived `chaseMs`
 * is snapshotted there, so a later tempo change cannot re-time a voice already in flight.
 */
export interface SpliceConfig {
  count: number;
  partition: SplicePartition;
  /** 0..1 random variation in splice LENGTH (0 = every splice the same width). */
  jitter: number;
  seed: number;
  chase: SpliceChaseMode;
  /** Resolved chase interval in ms (one splice per interval in `step`, one full lap in
      `smooth`). ≤ 0 disables movement. */
  chaseMs: number;
  /** +1 = up the strip / clockwise, −1 = the other way. */
  direction: 1 | -1;
  /** Pixels the cut jumps per interval in `'stagger'`. Ignored by the other modes. */
  incrementPx: number;
  /**
   * Milliseconds each partition unit's motion starts AFTER the one before it in {@link order}
   * — so a chase can climb a drum hoop by hoop instead of every hoop moving in lockstep. 0
   * (the default) means every unit moves together, which is the previous behaviour exactly.
   * A unit that has not reached its start shows the cut standing still, not darkness.
   */
  offsetMs: number;
  /** The order units start moving in when {@link offsetMs} is non-zero. */
  order: SpliceOrder;
  /** Milliseconds each DRUM's motion starts after the one before it, on top of {@link offsetMs}.
      Only meaningful under the `'hoop'` partition, where hoops and drums are separate axes — it
      is what sends a kit-wide splice travelling drum to drum. 0 = every drum together. */
  drumOffsetMs: number;
  /** The order drums start moving in when {@link drumOffsetMs} is non-zero. */
  drumOrder: SpliceOrder;
  /**
   * An explicit drum firing order, by drum id — THROUGH KIT's dragged sequence. When present it
   * replaces the drum pattern ({@link drumOrder} on a hoop cut, {@link order} on a drum cut, where
   * the drums ARE the primary axis). Drums it does not name follow in model order, so it is always
   * a permutation and the cascade is never longer than the pattern's.
   */
  drumSequence?: string[];
  /** An explicit hoop firing order, 1-based — THROUGH DRUM's dragged sequence. Replaces
      {@link order} on a hoop cut; hoops it does not name follow in hoop order. */
  hoopSequence?: number[];
  /** Milliseconds each SPLICE starts after the one before it, in {@link colorOrder} — so the
      colours come on one after another rather than all together. Only visible when
      {@link waitMode} hides them first; 0 = every colour at once. */
  colorOffsetMs: number;
  /** The order the colours come on when {@link colorOffsetMs} is set. */
  colorOrder: SpliceOrder;
  /** Where the cut sits around the run, in degrees — a phase offset that rotates every band's
      start. 0 = the run's own start. */
  rotationDeg: number;
  /** 0..1 — how far each splice's colour bleeds into its neighbours across their shared edge.
      0 is a hard cut. Expressed as a fraction of the average band width, so it reads the same
      on a small hoop and a big kick. */
  smudge: number;
  /** Whether a hit restarts the motion or it free-runs across hits. */
  motionMode: SpliceMotionMode;
  /** Whether a unit waiting its turn in the cascade is lit and still, dark, or pulsing. */
  waitMode: SpliceWaitMode;
  /** The attack CURVE. Linear brightens far too fast to the eye, because perceived brightness
      is not linear in output — an ease-in family reads as a smooth swell. Absent → linear, the
      original behaviour. */
  attackEase?: EaseSpec;
  /** The AUTHORED envelope, carried here as well as on the action because `'pulse'` runs it
      per unit — and the voice's own `sustainMs` is extended to outlive the cascade, so it is
      no longer the authored hold by the time the compositor sees it. */
  envelope: { attackMs: number; sustainMs: number; releaseMs: number };
  /** 0..1 strength of the colour tint applied to an effect splice. */
  tint: number;
  /** Per-slot authored colour (null = none), index-aligned with the splice slots. */
  colors: (string | null)[];
  /** Splice slot index → index into the voice's `spliceInputs`; −1 = a blank slot. */
  inputBySlot: number[];
  /**
   * Present on a SLICE: cut through 3D space along a direction instead of around each hoop.
   * Everything else in this config means the same thing for both — which is the point, since
   * it lets a slice ride the splice's eval, voice and cascade machinery unchanged.
   */
  space?: SliceSpace;
}

/** The world axis a slice is stacked along, before any tilt. */
export type SliceAxis = 'x' | 'y' | 'z';

/** An axis-aligned box of world space, in mm — what a slice restricted to SPACE covers. */
export interface SliceRegion {
  min: Vec3;
  max: Vec3;
}

/** The 3D half of a slice config — see {@link import('./slice')}. */
export interface SliceSpace {
  /** Unit vector the slabs are stacked along; the slab faces are perpendicular to it. */
  direction: Vec3;
  /** When set, only pixels inside this box are sliced, and the slabs span the box itself. */
  region?: SliceRegion;
  /** 0..1 — how strongly hit velocity scales brightness (0 ignores it, 1 is fully proportional). */
  velocity: number;
  /** How far a `'stagger'` jump moves the slabs, as a fraction of the span. */
  incrementFrac: number;
}

/**
 * The splice / slice layout fields `resolveSplices` / `resolveSlice` read — the Splice and Slice
 * generators' params, projected by `spliceDeviceNode` (effect-chain/resolve-splice.ts). Every
 * field is optional: `resolveSpliceConfig` (voice/splice.ts) supplies each default.
 */
export interface SpliceNode {
  /** The authored splices, in slot order. Fewer entries than {@link spliceCount} cycle:
      slot i takes `splices[i % splices.length]`, so 2 colours over 8 splices alternate. */
  splices?: SpliceDef[];
  /** How many splices each partition unit is cut into. */
  spliceCount?: number;
  splicePartition?: SplicePartition;
  /** 0..1 random variation in splice length. */
  spliceJitter?: number;
  /** Seed for the length jitter — the same seed always cuts the same pattern. */
  spliceSeed?: number;
  spliceChase?: SpliceChaseMode;
  /** `'beats'` → resolve {@link spliceDivision} against the bpm at spawn; `'time'` → use
      {@link spliceRateMs} directly. Same two-mode shape as the delay node. */
  spliceRateMode?: 'time' | 'beats';
  /** Chase interval in milliseconds (used when `spliceRateMode === 'time'`). */
  spliceRateMs?: number;
  /** Musical division (used when `spliceRateMode === 'beats'`) — the `DELAY_DIVISIONS` set
      in `delay.ts`, resolved by the same `computeDelayMs`, so a 1/8 chase and a 1/8 delay
      can never disagree about what an eighth note is. */
  spliceDivision?: string;
  /** Chase direction: +1 or −1. */
  spliceDirection?: 1 | -1;
  /** Pixels the cut jumps each interval when `spliceChase === 'stagger'`. Independent of
      splice width on purpose — a 3px stagger over 12px splices creates a slow crawl the
      splice-wide `'step'` chase cannot express. */
  spliceIncrementPx?: number;
  /** How the per-unit motion offset is expressed: resolved against bpm (`'beats'`) or taken
      as milliseconds (`'time'`). Absent → `'beats'`. */
  spliceOffsetMode?: 'time' | 'beats';
  /** Per-unit motion offset in milliseconds (used when `spliceOffsetMode === 'time'`).
      Absent/0 → every unit moves together. */
  spliceOffsetMs?: number;
  /** Musical division for the per-unit offset (used when `spliceOffsetMode === 'beats'`).
      Absent → no offset: a division only takes effect once one is chosen, so simply picking
      an order can never start a cascade the author did not ask for. */
  spliceOffsetDivision?: string;
  /** The order units start moving in when an offset is set. Absent → `'up'`. */
  spliceOrder?: SpliceOrder;
  /** Per-DRUM cascade offset (hoop partition only): how the movement travels across the kit,
      independently of how it travels up each drum. Same two-mode shape as the others. */
  spliceDrumOffsetMode?: 'time' | 'beats';
  spliceDrumOffsetMs?: number;
  spliceDrumOffsetDivision?: string;
  /** The order drums start moving in. Absent → `'up'`. */
  spliceDrumOrder?: SpliceOrder;
  /** 0..1 blend of each splice's colour into its neighbours. Absent/0 → hard-edged bands. */
  spliceSmudge?: number;
  /** Whether a hit restarts this splice's motion or it free-runs. Absent → `'restart'`. */
  spliceMotionMode?: SpliceMotionMode;
  /** Per-SPLICE cascade: the order the colours come on, and how far apart. Needs a
      {@link spliceWaitMode} other than `'lit'` to be visible — otherwise everything is already
      lit and there is no arrival to stagger. */
  spliceColorOffsetMode?: 'time' | 'beats';
  spliceColorOffsetMs?: number;
  spliceColorOffsetDivision?: string;
  spliceColorOrder?: SpliceOrder;
  /** Rotate the cut around each hoop/drum, 0..360°. Absent → 0. */
  spliceRotationDeg?: number;
  /** What a unit does before its cascade turn arrives. Absent → `'lit'` (the original
      behaviour: the whole kit lights at once and only the MOVEMENT cascades). */
  spliceWaitMode?: SpliceWaitMode;
  // Splice envelope. A splice node owns its own attack/hold/fade rather than inheriting the
  // first splice's effect, so how long the lights stay up after a hit is authorable — and so
  // reordering the splices cannot silently change the envelope. Absent → the defaults in
  // `splice.ts`.
  /** Rise time in ms. */
  spliceAttackMs?: number;
  /** How long it stays at full after the attack, in ms — the "stays on for" control. */
  spliceHoldMs?: number;
  /** Fade-out time in ms. */
  spliceReleaseMs?: number;
  /** Curve the attack rises on. Absent → linear. */
  spliceAttackEase?: EaseSpec;
  /**
   * What a hit does to a splice that is ALREADY looping. `'stop'` (the default) makes the node
   * self-toggling — hit to start, hit again to stop — which is the only way to end a loop
   * without a separate Toggle node, and also stops repeated hits stacking loops forever.
   * `'restart'` re-syncs it from the top instead, superseding the running voice.
   * Meaningless on a one-shot, which ends by itself.
   */
  spliceLoopRetrigger?: 'stop' | 'restart';
  /** 0..1 strength of a splice colour's tint over its effect. */
  spliceTint?: number;
  /** THROUGH KIT's explicit drum order (drum ids, first to fire first). Absent → the pattern. */
  spliceDrumSequence?: string[];
  /** THROUGH DRUM's explicit hoop order (1-based hoop numbers). Absent → the pattern. */
  spliceHoopSequence?: number[];
  // slice (only meaningful when kind === 'slice'). A slice reuses every `splice*` field above
  // for what it shares with a splice — count, jitter, motion, chases, envelope, rows — and adds
  // only its geometry here. All optional + additive.
  /** The world axis the slabs are stacked along, before tilting. Absent → `'x'`. */
  sliceAxis?: SliceAxis;
  /** Tilt of the slicing direction about the world X / Y / Z axes, degrees (applied X → Y → Z). */
  sliceRotX?: number;
  sliceRotY?: number;
  sliceRotZ?: number;
  /** A box of world space to slice, centre + size in mm. Absent → the node's scope (kit or drum). */
  sliceRegion?: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };
  /** 0..1 velocity sensitivity. Absent → 1 (fully velocity sensitive). */
  sliceVelocity?: number;
  /** `'stagger'` jump as a percentage of the slicing span. Absent → 10. */
  sliceIncrementPct?: number;
}

// ---- Runtime setlist (song → section → Effects) -----------------------------

/** One runtime section in a song arrangement: its Effect stack and Master chain. */
export interface SongSection {
  id: string;
  name: string;
  /** The section's authored Effect stack, in composition order (effect chains). */
  effects: Effect[];
  /** The section's master modifier chain (applied to the whole section's output; S02). */
  master?: ModifierDevice[];
  /** Cells that play their stack one Effect per fire (Sequence / Random) and what resets them;
      every other cell layers. See `effect-chain/cell-play`. */
  cellPlay?: CellPlay[];
}

/**
 * Runtime song: a named sequence of sections consumed by the engine.
 * Do not confuse this with the web-authored setlist `Song`.
 */
export interface ShowSong {
  id: string;
  name: string;
  sections: SongSection[];
}

// ---- Show aggregate (the runtime content) -----------------------------------

/**
 * The runtime content the engine runs: the setlist of songs → sections → Effects, the canvas
 * scenes they host and the MIDI-map mappings. Built by `effectChain.buildRuntimeShow`.
 */
export interface Show {
  songs: ShowSong[];
  /**
   * User-authored canvas scene documents. The engine registers these into the pure
   * canvas registry on `setShow()` so `canvas:<sceneId>` resolves through the normal
   * `EffectGenerator` lookup (no compositor fork, locked decision 7).
   */
  canvasScenes?: CanvasScene[];
  /**
   * MIDI-map bindings (effect chains): input sources bound to fire / recall / continuous
   * targets. A matched note / CC / OSC is consumed after global controls, before zones and
   * Cues (see `engine.ts`). The engine re-validates each entry at `setShow`.
   */
  mappings?: InputMapping[];
}

export function emptyShow(): Show {
  return { songs: [] };
}

/** The pad identity `"drumId:zone"` of a (drum, zone) hit. */
export function padKey(drumId: string, zone: string): string {
  return `${drumId}:${zone}`;
}

// ---- Voices (live instances — engine-internal, NOT part of the seam) --------

export type VoicePhase = 'attack' | 'sustain' | 'release';

/** Reusable per-voice scratch for sparse splice-member transport. Coverage is derived from the
 * current member buffers each frame and is intentionally not part of render checkpoints. */
export interface SpliceMaterialCoverage {
  memberCount: number;
  unitCount: number;
  /** Row-major member × partition-unit material flags. */
  materialUnits: Uint8Array;
  /** First material-bearing partition unit for each member, or -1 when empty. */
  sourceUnitByMember: Int32Array;
}

/**
 * A live light instance: a hosted generator + resolved params + envelope playing on a
 * bus. Object-pooled inside the engine; `active` marks pool occupancy. Identity for
 * cross-frame references (toggle latching, voice-stealing) is the string `id`.
 */
export interface Voice extends GeometryState {
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
  /** Authored material cycle duration, resolved once at member spawn BPM. Present only on
      Splice-owned members; ordinary Mix members remain on one continuous generator state. */
  materialCycleMs?: number;
  /** Buffer-level Mix branches rendered into intermediate buffers, then blended before
      this voice's downstream modifiers/output mask continue. Undefined for ordinary voices. */
  mixInputs?: MixInput[];
  /**
   * Splice members — one per NON-BLANK splice slot (a colour-only splice hosts the
   * `solid-colour` generator, so every member is uniformly a generator sub-voice). Each is
   * rendered once per frame into its own buffer; {@link splice} then decides which band of
   * pixels each one is actually shown through. Undefined for ordinary voices.
   */
  spliceInputs?: MixInput[];
  /** Resolved splice layout (bands, chase, tints) for {@link spliceInputs}. Present exactly
      when this voice came from a `splice` node. */
  splice?: SpliceConfig;
  /**
   * Accumulated motion time in ms for a `'latched'` splice. The engine advances it only while
   * a voice for this (pad, splice node) is alive and carries the total ACROSS voices, so the
   * movement resumes exactly where the fade left it. Stamped onto the voice each frame; the
   * other two motion modes ignore it.
   */
  spliceMotionMs?: number;
  /** Reused coverage scratch for sparse splice fallback; rebuilt when member/unit capacity grows. */
  spliceCoverage?: SpliceMaterialCoverage;
  /**
   * Resolved modifier chain (S28+): pure framebuffer transforms applied in order between
   * this voice's render and the compositor blend (see `modifiers/chain.ts`). Resolved from
   * the Effect's modifier devices at fire time; `undefined`/empty → the voice takes the
   * unchanged zero-alloc hot path. This flat chain is the seam.
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
   * Resolved modulation mappings onto this voice's effect params (doc 10). Populated from the
   * Effect's Control devices at fire time; `undefined`/empty → params take their unmodulated value.
   * The per-frame param sweep (`applyEffectiveParams`) sums each param's contributions and
   * clamps to the spec range. Same {@link Mapping} model + sampler as the modifier chain's
   * `ResolvedModifier.modulations` — one model, two carriers.
   */
  modulations?: Mapping[];
  /** resolved param snapshot at spawn (live params for the frame derive from this). */
  params: ParamValues;
  /** Blend mode used when this voice composites {@link mixInputs}. */
  mixBlendMode?: BlendMode;
  /** Effect-path voices only: the authored Effect id that spawned this voice. Retrigger
      (restart / ignore) and note-off release scan by it. */
  chainEffectId?: string;
  /** Effect-path voices only: the Effect's blend mode (compositing semantics land in S02). */
  blend?: BlendMode;
  /** Effect-path voices only: the Effect's opacity 0..1 (compositing semantics land in S02). */
  opacity?: number;
  /** Effect-path voices only: the Effect's index in its section stack (composition order). */
  layerOrder?: number;
  /**
   * Explicit multi-target list: each entry is a drum id or a `"<drumId>#<h1>,<h2>"` hoop id.
   * When present the voice renders over the UNION of those ranges, overriding `scope` /
   * `targetId`; absent keeps today's scope resolution.
   */
  targets?: string[];
  /**
   * Per-frame effective params (envelopes + tempo-sync applied). A reused scratch
   * object owned by the pool slot — the engine refills it each tick before the
   * compositor reads it, so the hot path stays allocation-free.
   */
  liveParams: ParamValues;
  /** The spawning effect's param specs (by reference) — drives modulation ranges. */
  specs: ParamSpec[];
  attackMs: number;
  /** Curve the attack rises on (absent → linear). Carried from a node that authors one; the
      per-frame envelope advance eases the ramp with it. */
  attackEase?: EaseSpec;
  sustainMs: number;
  releaseMs: number;
  /**
   * Authored amplitude-over-life curve, copied from the spawning node (S6b) and already
   * normalised. `null`/absent → no envelope, and every level below is what it always was.
   */
  lifeEnvelope?: CurveValue | null;
  /**
   * Real-time width of {@link lifeEnvelope}'s x axis, resolved at spawn (ms, beats already
   * converted at the spawn bpm). Stored so the per-frame tick stays a pure multiply with no
   * registry lookup and no allocation.
   */
  lifeSpanMs?: number;
  phase: VoicePhase;
  level: number;
  bornAtMs: number;
  releaseAtMs: number | null;
  releaseFromLevel: number;
  /** A release ramp set by an Effect's cap across hits (Dot's Max alive, Fade) — wins over the
      mode's own ramp for this release. Cleared on spawn. */
  capReleaseMs?: number;
  via: string;
  deckGain: number;
  /** Spawn key this voice was spawned under (`effect:<id>` on the Effect path). Scopes
      origin-keyed liveness scans (`VoicePool.isLayerLive`). */
  pad?: string;
  /** Origin tag this voice's layer was produced under. Read by `VoicePool.isLayerLive`. */
  originNodeId?: string;
}

export interface MixInput extends GeometryState {
  generatorId: string;
  scope: Scope;
  targetId?: string;
  sourceDrumId: string | null;
  velocity: number;
  seed: number;
  params: ParamValues;
  liveParams: ParamValues;
  specs: ParamSpec[];
  modulations?: Mapping[];
  genState: unknown;
  /** Authored material cycle duration, resolved once at member spawn BPM. Present only on
      Splice-owned members; ordinary Mix members remain on one continuous generator state. */
  materialCycleMs?: number;
  modifiers?: ResolvedModifier[];
  modState?: unknown[];
  opacity: number;
  /** Origin tag of this member — carried so `VoicePool.isLayerLive` can report member liveness. */
  originNodeId?: string;
}
