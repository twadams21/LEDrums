/**
 * Outer seam — the host ↔ brain interface for the voice-bus lighting model.
 * {@link RenderEngine} is the small, host-facing surface; behind it sit the Effect resolver
 * (`effect-chain/resolver.ts`), an object-pooled voice store (`voice-pool.ts`), transport-
 * driven envelopes (`envelope-tick.ts`), and the inner {@link Compositor} seam
 * (voices → pixels).
 *
 * Purity / determinism (non-negotiable): `tick` is a pure function of (state, time,
 * inputs). No `Math.random` / `Date.now` — all randomness is a seeded {@link Prng}
 * carried in engine state. Zero allocation on the hot path: the voice pool, per-frame
 * scratch, and the compositor's buffers are all pre-sized and reused.
 */
import type { Framebuffer } from '../engine/framebuffer';
import { Framebuffer as Fb } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { Prng } from './prng';
import {
  createDefaultCompositor,
  applyEffectiveParams,
  type Compositor,
} from './compositor';
import { VoicePool, releaseVoice } from './voice-pool';
import { registerCanvasScene, unregisterCanvasScene } from '../canvas/registry';
import { BUILTIN_CANVAS_SCENES } from '../canvas/presets';
import type { CanvasScene } from '../canvas/types';
import { shapeCascadeVoice, advanceLatchedSpliceMotion } from './runtime-policy';
import { ensureGeometryState } from './geometry-state';
import { advanceEnvelopes, reapDeadVoices } from './envelope-tick';
import { ccKey, ccValue01, noteKey, noteValue01, oscValue01, type NoteState } from './modulation';
import { normalizeAudioFrame, type AudioFeatureFrame, type AudioTable } from './audio-features';
import {
  emptyShow,
  normalizeTriggerValue,
  type Bus,
  type EffectDef,
  type PlayMode,
  type Show,
  type SongSection,
  type Voice,
} from './types';
import { relativeNavTarget, type NavAxis } from './navigation';
import type { GlobalControlAction } from '../model/global-controls';
import { clamp01 } from '../math';
import {
  alwaysEffects,
  cellEffects,
  clockEffectsCrossed,
  effectPlayAction,
  matchSectionEffects,
  resolveContinuousInputMappings,
  type ContinuousInputBinding,
  type EffectInputEvent,
} from '../effect-chain/resolver';
import { pickCellPlay, resetCellSteps, type CellSteps } from '../effect-chain/cell-play';
import {
  isContinuousTarget,
  matchInputMapping,
  parseInputMappings,
  scaleInputMappingValue,
  type InputMapping,
  type InputMappingEvent,
} from '../effect-chain/input-mappings';
import { applySectionMaster, createSectionMasterState, resetSectionMaster } from '../effect-chain/master';
import { CHAIN_BUS, CHAIN_BUS_ID, chainEffectDef } from '../effect-chain/runtime';
import type { Effect } from '../effect-chain/types';
import type {
  EffectSkipReason,
  VoiceDiagnosticSink,
  VoiceInputDescriptor,
} from './diagnostics';

// ---- Public seam ------------------------------------------------------------

export interface InputEvent {
  kind: 'noteOn' | 'noteOff' | 'osc' | 'oscValue' | 'key' | 'recallSection' | 'recallSongIndex' | 'recallSectionIndex' | 'fireEffect' | 'cc' | 'globalControl' | 'releaseBus' | 'audioFeatures';
  drumId?: string;
  zone?: string;
  note?: number;
  velocity?: number;
  address?: string;
  value?: number;
  /** cc (S37): the MIDI controller number (0..127) and its channel (1..16). `value` carries
      the raw 0..127 CC value; the engine normalizes it to 0..1 in its CC table. */
  controller?: number; // S37
  channel?: number; // S37
  /** recallSection: activate a song's section so hits fire its Effects. */
  songId?: string | null;
  sectionId?: string | null;
  /** Transport recall intents. Indices resolve only when the queued event is processed. */
  songIndex?: number;
  sectionIndex?: number;
  /** globalControl: the app-general action a bound note/address resolved to (input
      step 0). Relative navigation resolves HERE, against the engine's live active
      song/section, so N queued taps advance N steps rather than all reading one
      stale position. */
  action?: GlobalControlAction;
  /** globalControl (momentary only): the edge. `true` = pressed, `false` = released.
      Absent for trigger/continuous actions, which have no held state. */
  pressed?: boolean;
  /** fireEffect: the authored Effect id (of the ACTIVE section) to audition — an authoritative
      intent for keyboard audition and MIDI-map, not a source to re-resolve. */
  effectId?: string;
  /** releaseBus: release every active voice on this bus (absent = all buses — panic). */
  busId?: string;
  /** audioFeatures (GH #214): the latest analysed frame. Replaces the engine's audio table and
      NEVER fires an Effect — audio is a continuous modulation source, not a trigger. */
  audio?: AudioFeatureFrame;
  timeMs: number;
}

/** Per-voice line item in {@link EngineStats.voices}: the minimal shape a client's Layers/Buses
 * dock renders (id, bus, effect, mode, combined level, hue, release phase, provenance). Distinct
 * from the internal pooled {@link Voice} — pattern / envelope / generator state stay engine-side.
 * Built only in {@link RenderEngine.stats} (the ~2 Hz telemetry cadence), never on the render hot
 * path. */
export interface VoiceStat {
  id: string;
  busId: string;
  effectId: string;
  mode: PlayMode;
  /** Combined `level * deckGain`, 0..1. */
  level: number;
  /** Param hue (0 when the effect exposes none). */
  hue: number;
  /** True while the voice is in its release (fade-out) phase. */
  releasing: boolean;
  via: string;
  /** The spawn key this voice was spawned under — `effect:<effectId>` on the Effect path, so a
   * client can attribute a live voice back to the Effect playing it. Empty string when the spawn
   * path supplied none. */
  pad: string;
}

export interface EngineStats {
  timeMs: number;
  beat: number;
  voiceCount: number;
  busLevels: Record<string, number>;
  /** Per-voice detail for a connected client's dock (S17). Empty when no voices are active. */
  voices: VoiceStat[];
  perf: EnginePerfStats;
}

export interface EnginePerfStats {
  tickMs: number;
  queueMs: number;
  pendingMs: number;
  envelopeMs: number;
  paramsMs: number;
  compositeMs: number;
  voiceCount: number;
}

export interface RenderEngine {
  setModel(model: PixelModel): void;
  setShow(show: Show): void;
  applyInput(ev: InputEvent): void;
  getActiveSelection(): { activeSongId: string | null; activeSectionId: string | null };
  tick(now: number, dt: number, transport: TransportState): void;
  /** composited RGBA, stride 4, no copy. */
  frame(): Readonly<Float32Array>;
  stats(): EngineStats;
}

export interface RenderEngineOptions {
  onDiagnostic?: VoiceDiagnosticSink;
}

const PRNG_SEED = 0x1a2b3c4d;

/**
 * The global control actions that are a relative setlist move, and the move each one
 * makes. Partial by design: controls that are not navigation (blackout, brightness, …)
 * simply have no entry and are dispatched by their own branch.
 */
const NAV_MOVES: Partial<Record<GlobalControlAction, { axis: NavAxis; delta: number }>> = {
  nextSong: { axis: 'song', delta: 1 },
  prevSong: { axis: 'song', delta: -1 },
  nextSection: { axis: 'section', delta: 1 },
  prevSection: { axis: 'section', delta: -1 },
};

interface ActiveSelection {
  activeSongId: string | null;
  activeSectionId: string | null;
}

/** The deterministic selection used when a show has no still-valid active pair. */
function firstSelection(show: Show): ActiveSelection {
  const song = show.songs[0];
  return {
    activeSongId: song?.id ?? null,
    activeSectionId: song?.sections[0]?.id ?? null,
  };
}

/** A selection is valid only as the exact song/section pair it names. In particular, null is
 * a section value only for a real zero-section song; it is not a wildcard that keeps a stale
 * section's Always Effects alive. */
function isValidSelection(show: Show, selection: ActiveSelection): boolean {
  if (selection.activeSongId === null) return false;
  const song = show.songs.find((candidate) => candidate.id === selection.activeSongId);
  if (!song) return false;
  return selection.activeSectionId === null
    ? song.sections.length === 0
    : song.sections.some((section) => section.id === selection.activeSectionId);
}

// ---- Production adapter ------------------------------------------------------

/**
 * The production brain. Owns: a time-stamped input queue (drained at tick), Effect
 * resolution → play actions, an object-pooled voice store, transport-driven voice envelopes,
 * and the inner compositor. `frame()` returns the final framebuffer's rgba (no copy).
 */
class VoiceBusEngine implements RenderEngine {
  constructor(private readonly onDiagnostic?: VoiceDiagnosticSink) {}

  private model: PixelModel | null = null;
  private finalFb: Framebuffer | null = null;
  private readonly compositor: Compositor = createDefaultCompositor();

  private show: Show = emptyShow();

  /**
   * The internal spawn lookups. An Effect's action names an engine-synthesised EffectDef
   * (`@chain:<generatorId>`, built lazily from the generator registry) on the internal poly bus,
   * so the Show carries no buses or effect definitions. The envelope tick is handed no buses, so
   * a released loop/hold voice fades on its own `releaseMs` rather than a bus crossfade.
   */
  private chainEffects = new Map<string, EffectDef>();
  private readonly chainBuses = new Map<string, Bus>([[CHAIN_BUS_ID, CHAIN_BUS]]);
  /**
   * MIDI-map (effect chains wave 5): the show's valid InputMappings, re-validated at `setShow`
   * (the wire gate does not deep-check them). A note / CC / OSC that matches one is CONSUMED
   * — after global controls (resolved by the host before the event reaches the engine),
   * before zones and Cues.
   */
  private inputMappings: InputMapping[] = [];
  /**
   * The latest 0..1 value each mapping's source sent, keyed by mapping id. Written ONLY inside
   * the queue drain (a pure function of the event log, like {@link ccTable}); cleared at
   * `setShow`. A continuous mapping writes its target only once its source has been heard, so
   * an untouched knob leaves the authored value alone. Discrete CC mappings read it for their
   * rising edge.
   */
  private mappingValues = new Map<string, number>();
  /** The continuous mappings resolved against the ACTIVE section (re-resolved on show load and
      on every recall), applied to live voices every frame. */
  private continuousBindings: ContinuousInputBinding[] = [];
  /** Transport beat at the previous tick — Clock Effects fire on grid crossings since it.
      `null` until the first tick after a `setShow` (nothing is crossed on that tick). */
  private lastClockBeat: number | null = null;

  /**
   * Scene ids this engine has registered into the pure canvas registry (from the
   * current show's `canvasScenes`). Tracked so `setShow` can unregister scenes that a
   * later show drops, keeping the global registry in sync with the active show.
   */
  private readonly registeredCanvasSceneIds = new Set<string>();

  /**
   * Accumulated motion time per `(pad, splice node)` for `'latched'` splices, in ms. Advanced
   * once per frame per key while ANY voice for that key is alive, and deliberately NOT while
   * the kit is dark — that is the whole difference between latched and continuous. Kept here
   * rather than on the voice because it has to OUTLIVE the voice: the next hit resumes from it.
   */
  private spliceMotionMs = new Map<string, number>();

  // Object-pooled voices (fixed-size slab; `acquire`/`release`/`spawn` in voice-pool.ts).
  private readonly voices = new VoicePool();

  /** Latch map the voice pool reads / reaps (`PlayAction.latchKey`). The Effect path spawns
      unlatched voices, so it stays empty; kept because the unchanged pool takes it. */
  private latched = new Map<string, string | null>();

  private prng = new Prng(PRNG_SEED);

  /** Where each Sequence / Random cell of the active section is in its stack (`cell-play`).
      Changed only by fires, resets and section starts inside the queue drain / tick, so it is a
      pure function of the event log like every other live table here. */
  private cellSteps: CellSteps = new Map();

  /**
   * Live MIDI CC value table (S37): keyed by controller+channel → 0..1 (see `ccKey`).
   * Updated ONLY inside the queue drain (`processEvent`), so it is a pure function of the
   * event log — same events ⇒ same table ⇒ same frames. Threaded into the per-frame
   * modulation sweep each tick; a `cc` modulation source reads its controller here.
   */
  private ccTable = new Map<string, number>();

  /**
   * Live OSC value table: keyed by OSC address → 0..1. The OSC analogue of {@link ccTable},
   * updated ONLY inside the queue drain (a pure function of the event log), read by an `osc`
   * modulation source each frame. An OSC event both fires Cue Effects AND feeds this table,
   * so the same address can drive a trigger and modulate params.
   */
  private oscTable = new Map<string, number>();
  private noteTable = new Map<string, NoteState>();
  /**
   * Latest audio feature frame (GH #214) stamped with the engine time it was queued at. Written
   * ONLY inside the queue drain; read per frame by `audio` modulation sources through
   * `sampleAudio`, which zeroes it once older than `AUDIO_STALE_MS`. `null` until the first frame.
   */
  private audioTable: AudioTable | null = null;

  private queue: Array<{ event: InputEvent; order: number }> = [];
  private inputOrder = 0;
  private timeMs = 0;
  private beat = 0;
  private bpm = 120;
  /** Beats per bar from the transport — read only by the bar-length musical divisions. */
  private beatsPerBar = 4;
  private perf: EnginePerfStats = emptyPerfStats();

  /**
   * Active song/section for hit resolution. Set via `recallSection`
   * input events (queued + drained deterministically, never mutated outside the
   * queue drain). `setShow` preserves the pair when it remains valid and otherwise
   * seeds from the first valid song/section so stale ids don't resolve against a new
   * arrangement.
   */
  private activeSongId: string | null = null;
  private activeSectionId: string | null = null;

  /** The engine-owned recall pointer. The server may expose this for synchronization, but it
   * never supplies an ordering token or session id to core. */
  getActiveSelection(): { activeSongId: string | null; activeSectionId: string | null } {
    return { activeSongId: this.activeSongId, activeSectionId: this.activeSectionId };
  }

  /**
   * Panic blackout: the output reads black while set, but NOTHING else changes —
   * voices keep advancing, envelopes keep running, sequencers keep counting. That is
   * the whole point: recovery is instant rather than a re-cue. Applied at the output
   * stage in {@link frame}, never by pausing the engine.
   *
   * Operator state, not authored state, so `setShow` deliberately leaves it alone: a
   * panic must survive an edit landing mid-panic.
   */
  private blackout = false;

  /** Master brightness, 0..1 — a global output-stage dimmer multiplying the final
      frame. Operator state, like {@link blackout}. */
  private brightness = 1;

  /** Scratch for the gained/blacked-out output frame, so the composited buffer is
      never mutated (it is read again for stats and may be read twice per tick).
      Allocated once per model, never on the hot path. */
  private outFb: Float32Array | null = null;

  /** The active section's Master chain state (effect chains, S02): its clock restarts and its
      modifier state drops on section recall and on a model change. */
  private readonly masterState = createSectionMasterState();

  // --- lifecycle ---------------------------------------------------------

  setModel(model: PixelModel): void {
    for (const v of this.voices.pool) if (v.active) ensureGeometryState(v, model);
    this.model = model;
    this.finalFb = new Fb(model.pixelCount);
    this.outFb = new Float32Array(model.pixelCount * 4);
    resetSectionMaster(this.masterState);
  }

  /**
   * Register the show's canvas scenes into the pure canvas registry and unregister any
   * scenes a prior show owned but this one drops — so `canvas:<sceneId>` resolves through
   * the normal generator bridge for exactly the active show's scenes.
   */
  private syncCanvasScenes(scenes: readonly CanvasScene[] | undefined): void {
    const nextIds = new Set((scenes ?? []).map((scene) => scene.id));
    for (const id of [...this.registeredCanvasSceneIds]) {
      if (!nextIds.has(id)) {
        unregisterCanvasScene(id);
        this.registeredCanvasSceneIds.delete(id);
        // A show scene may have shadowed a core built-in (same id) — restore the
        // built-in registration so `canvas:<id>` keeps resolving after the show drops it.
        const builtin = BUILTIN_CANVAS_SCENES.find((scene) => scene.id === id);
        if (builtin) registerCanvasScene(builtin);
      }
    }
    for (const scene of scenes ?? []) {
      registerCanvasScene(scene);
      this.registeredCanvasSceneIds.add(scene.id);
    }
  }

  setShow(show: Show): void {
    const previousSelection: ActiveSelection = {
      activeSongId: this.activeSongId,
      activeSectionId: this.activeSectionId,
    };
    // A show replacement invalidates every queued intent from the previous arrangement.
    this.queue = [];
    this.inputOrder = 0;
    this.syncCanvasScenes(show.canvasScenes);
    this.show = show;
    // Authored content changed: clear live state so resolution starts clean & deterministic.
    this.voices.reset();
    this.latched.clear();
    this.spliceMotionMs.clear(); // authored content replaced → latched motion starts fresh
    this.prng.reseed(PRNG_SEED);
    this.cellSteps = new Map(); // fresh content → every sequence starts at step 1
    this.ccTable.clear(); // S37: fresh show → no lingering CC values
    this.oscTable.clear(); // fresh show → no lingering OSC values
    this.noteTable.clear();
    this.audioTable = null; // fresh show → no lingering audio frame
    this.chainEffects.clear(); // canvas scenes may have changed → rebuild chain defs lazily
    this.lastClockBeat = null;
    this.inputMappings = parseInputMappings(show.mappings).mappings;
    this.mappingValues.clear(); // fresh show → no lingering knob positions (like the CC table)
    // Preserve the engine-authoritative pair across equivalent/updated shows. A replacement
    // still gets a deterministic first song/section when the old pair no longer exists.
    const selection = isValidSelection(show, previousSelection) ? previousSelection : firstSelection(show);
    this.activeSongId = selection.activeSongId;
    this.activeSectionId = selection.activeSectionId;
    this.resolveContinuousBindings();
  }

  /** Re-resolve the continuous mappings against the active section (show load, recall). */
  private resolveContinuousBindings(): void {
    this.continuousBindings = resolveContinuousInputMappings(this.inputMappings, this.activeEffectSection());
  }

  /**
   * Shape a freshly spawned splice voice's own envelope around its cascade. Two corrections,
   * both needing the MODEL (how many hoops, how many drums), which is why this lives in the
   * engine and not the voice pool:
   *
   * 1. It has to OUTLIVE its cascade. The last hoop's turn comes `maxCascadeDelayMs` after the
   *    hit, so a voice whose hold ends before then is cut off mid-travel and the far side of
   *    the kit never lights at all.
   * 2. Under a per-unit envelope (`fade`/`pulse`) the voice's own ATTACK must get out of the
   *    way. Each unit already applies the authored attack itself, so leaving the global one in
   *    place multiplies the two for whichever unit is revealed at age 0 — that colour ramps on
   *    a squared curve while every later one, arriving after the global attack has finished,
   *    ramps linearly. The attack is moved into the hold rather than dropped, so the voice
   *    still lives exactly as long as the last unit needs.
   *
   * The AUTHORED envelope is untouched on `splice.envelope`, which is what the per-unit shaping
   * reads — so none of this stretches an individual unit's attack/hold/fade.
   */
  private shapeCascadeVoice(voice: Voice | null): void {
    shapeCascadeVoice(voice, this.model);
  }

  /**
   * Advance the latched-motion accumulator for every `(pad, splice node)` with a live voice,
   * then stamp the total onto those voices for the compositor to read as their motion clock.
   *
   * Advanced once per KEY, not once per voice: two overlapping hits on one pad are one moving
   * pattern, so counting dt twice would double its speed for as long as they overlap.
   */
  private advanceLatchedSpliceMotion(dt: number): void {
    advanceLatchedSpliceMotion(this.voices.pool, this.spliceMotionMs, dt);
  }

  // --- input -------------------------------------------------------------

  applyInput(ev: InputEvent): void {
    this.queue.push({ event: ev, order: this.inputOrder++ });
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    const due = this.queue.filter(({ event }) => event.timeMs <= this.timeMs);
    this.queue = this.queue.filter(({ event }) => event.timeMs > this.timeMs);
    due.sort((a, b) => a.event.timeMs - b.event.timeMs || a.order - b.order);
    for (const { event } of due) this.processEvent(event);
  }

  /**
   * Activate a song's section — the ONE place `activeSongId` / `activeSectionId` change
   * during a queue drain. Both the absolute `recallSection` input and a relative
   * global-control navigation land here, so they are indistinguishable downstream
   * (same diagnostic, same Always-Effect spawn).
   */
  private recallTo(songId: string | null, sectionId: string | null): boolean {
    // A section-only recall is a valid client input: resolve it against the engine's currently
    // active song, never against a host-side selection mirror.
    const song = songId === null
      ? this.show.songs.find((candidate) => candidate.id === this.activeSongId)
      : this.show.songs.find((candidate) => candidate.id === songId);
    const section = song && sectionId !== null ? song.sections.find((candidate) => candidate.id === sectionId) : undefined;
    // A null section identifies a real zero-section song. It must never silently turn a
    // non-empty song into a song-only recall, because that would clear the active section's
    // Always Effects while leaving the engine on an arrangement that has a valid section to play.
    const validSongRecall = song !== undefined && (
      sectionId !== null
        ? section !== undefined
        : song.sections.length === 0
    );
    if (!validSongRecall) return false;
    this.activeSongId = song.id;
    this.activeSectionId = sectionId;
    resetSectionMaster(this.masterState);
    this.resolveContinuousBindings();
    this.onDiagnostic?.({
      kind: 'section-recalled',
      songId: this.activeSongId,
      sectionId: this.activeSectionId,
    });
    // Leaving a section releases every sustained voice it owned (Always Effects and held
    // fires) so a recall never stacks, then the new section's Always Effects spawn. One-shots
    // decay on their own.
    for (const v of this.voices.pool) {
      if (v.active && v.mode !== 'oneshot') releaseVoice(v, this.timeMs);
    }
    // A section start sends every Sequence / Random cell back to its first step.
    this.cellSteps = new Map();
    const effectSection = this.activeEffectSection();
    if (effectSection) {
      for (const effect of alwaysEffects(effectSection)) this.fireChainEffect(effectSection, effect, 1, null, null, 'always');
    }
    return true;
  }

  /**
   * Resolve a global control action against live engine state. Navigation actions
   * become a relative move on the setlist (clamped at both ends — see
   * {@link relativeNavTarget}); a move with nowhere to go is a silent no-op rather
   * than a re-recall of the current section, which would restart its Always Effects.
   */
  private processGlobalControl(e: InputEvent): void {
    const action = e.action;
    if (!action) return;

    const move = NAV_MOVES[action];
    if (move) {
      const target = relativeNavTarget(
        this.show,
        { activeSongId: this.activeSongId, activeSectionId: this.activeSectionId },
        move.axis,
        move.delta,
      );
      if (target) this.recallTo(target.songId, target.sectionId);
      return;
    }

    switch (action) {
      case 'panicBlackoutMomentary':
        // Held: the press sets, the release clears. `pressed` is the edge the host
        // derived from note-on/note-off (or an OSC nonzero/zero).
        this.blackout = e.pressed !== false;
        return;
      case 'panicBlackoutLatch':
        this.blackout = !this.blackout;
        return;
      case 'stopAllVoices':
        this.releaseTriggerVoices();
        return;
      case 'masterBrightness': {
        // A malformed value must never poison the output stage — `clamp01` propagates
        // NaN (Math.min/max do), which would blank the rig with no way back.
        const v = e.value;
        this.brightness = typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 1;
        return;
      }
      default:
        // Host-level actions (tap tempo, transmit toggle) never reach the engine — the
        // host consumes them, because bpm and the output adapters live there. `sequenceResync`
        // has no engine state to re-sync on the Effect model (no sequencers): a no-op.
        return;
    }
  }

  /**
   * Release every running TRIGGER voice, leaving the section's base layer alone — the softer
   * panic. Always Effects spawn in `loop` mode, so sparing `loop` is what keeps the section's
   * base rendering while the hits let go. Uses the normal release phase, so effects fade on
   * their own envelopes rather than cutting.
   */
  private releaseTriggerVoices(): void {
    for (const v of this.voices.pool) {
      if (v.active && v.mode !== 'loop' && v.phase !== 'release') releaseVoice(v, this.timeMs);
    }
  }

  private processEvent(e: InputEvent): void {
    if (e.kind === 'releaseBus') {
      // The dock's explicit stop: release EVERY active voice on the bus — loops included
      // (Always Effects stop too), unlike the softer
      // releaseTriggerVoices. Absent busId = all buses (panic). Voices fade on their own
      // release envelopes rather than cutting.
      for (const v of this.voices.pool) {
        if (v.active && v.phase !== 'release' && (!e.busId || v.busId === e.busId)) {
          releaseVoice(v, this.timeMs);
        }
      }
      return;
    }
    if (e.kind === 'recallSection') {
      // Activate a section so subsequent hits fire its Effects.
      this.recallTo(e.songId ?? null, e.sectionId ?? null);
      return;
    }
    if (e.kind === 'recallSongIndex') {
      const songIndex = e.songIndex;
      if (typeof songIndex !== 'number' || !Number.isInteger(songIndex)) return;
      const song = this.show.songs[songIndex];
      const section = song?.sections[0];
      if (song) this.recallTo(song.id, section?.id ?? null);
      return;
    }
    if (e.kind === 'recallSectionIndex') {
      const sectionIndex = e.sectionIndex;
      if (typeof sectionIndex !== 'number' || !Number.isInteger(sectionIndex)) return;
      const song = e.songIndex === undefined
        ? this.show.songs.find((candidate) => candidate.id === this.activeSongId)
        : this.show.songs[e.songIndex];
      const section = song?.sections[sectionIndex];
      if (song && section) this.recallTo(song.id, section.id);
      return;
    }
    if (e.kind === 'globalControl') {
      this.processGlobalControl(e);
      return;
    }
    if (e.kind === 'fireEffect') {
      this.processFireEffect(e);
      return;
    }
    if (e.kind === 'cc') {
      const ccSection = this.activeEffectSection();
      const wasHigh = (this.ccTable.get(ccKey(e.controller ?? 0, null)) ?? 0) >= CC_CUE_THRESHOLD;
      // Update the CC value table (S37): write the normalized 0..1 value under BOTH the
      // specific-channel key and the omni key, so an omni mapping (channel filter off) always
      // reads the latest regardless of the sending channel. Deterministic: state only ever
      // changes here, on the drained event log.
      const controller = e.controller ?? 0;
      const value01 = ccValue01(e.value ?? 0);
      this.ccTable.set(ccKey(controller, e.channel ?? null), value01);
      this.ccTable.set(ccKey(controller, null), value01);
      // MIDI-map: a mapped controller is consumed here — it never also edges a CC Cue.
      if (this.performInputMapping(e, { midiCc: controller }, value01)) return;
      // A Cue on this controller fires on the RISING edge through the half-way
      // point (a button's press, a knob sweeping up), never on every value while it moves.
      if (ccSection && !wasHigh && value01 >= CC_CUE_THRESHOLD) {
        this.fireMatchedEffects(ccSection, e, { midiCc: controller }, value01, null);
      }
      return;
    }
    if (e.kind === 'noteOn' && e.note !== undefined) {
      const velocity = noteValue01(e.velocity ?? 0);
      this.noteTable.set(noteKey(e.note, e.channel ?? null), { gate: 1, velocity, releasedAtMs: null });
      this.noteTable.set(noteKey(e.note, null), { gate: 1, velocity, releasedAtMs: null });
      // MIDI-map: a mapped note is consumed before zones and Cues.
      if (this.performInputMapping(e, { midiNote: e.note }, 1)) return;
    }
    if (e.kind === 'noteOff' && e.note !== undefined) {
      const write = (channel: number | null): void => {
        const key = noteKey(e.note!, channel);
        const prev = this.noteTable.get(key);
        this.noteTable.set(key, { gate: prev?.gate ?? 0, velocity: prev?.velocity ?? 0, releasedAtMs: this.timeMs });
      };
      write(e.channel ?? null);
      write(null);
      if (this.performInputMapping(e, { midiNote: e.note }, 0)) return;
      // A note-off releases the `hold` Effects its note / zone fired.
      const heldSection = this.activeEffectSection();
      if (heldSection) {
        for (const effect of matchSectionEffects(heldSection, effectInputOf(e))) {
          if (effect.amp.length === 'hold') this.voices.releaseChainVoices(effect.id, this.timeMs, ['hold']);
        }
      }
    }
    // An audio feature frame ONLY replaces the audio table (GH #214). It is never a trigger: it
    // returns here before any Effect resolution, so a 30 Hz sender cannot fire or miss anything.
    if (e.kind === 'audioFeatures') {
      this.audioTable = { frame: normalizeAudioFrame(e.audio), atMs: e.timeMs };
      return;
    }
    // An OSC event ALSO feeds the OSC value table (an `osc` modulation source reads its address
    // here) in addition to firing Cue Effects below — deterministic: state only changes here.
    if ((e.kind === 'osc' || e.kind === 'oscValue') && e.address !== undefined) {
      const value = oscValue01(e.value ?? 0);
      // Track feature/gate updates are modulation only: no Effect fires, no global control.
      // Clearing a local signal removes its key, so expired device IDs do not leak.
      if (e.kind === 'oscValue' && value === 0) this.oscTable.delete(e.address);
      else this.oscTable.set(e.address, value);
      // MIDI-map: a mapped address is consumed before zones and Cues.
      if (this.performInputMapping(e, { oscAddress: e.address }, value)) return;
    }
    if (e.kind === 'oscValue') return;

    // noteOn / key / osc fire the active section's matching Effects.
    if (e.kind !== 'noteOn' && e.kind !== 'key' && e.kind !== 'osc') return;

    const velocity = e.kind === 'osc'
      ? normalizeTriggerValue({ kind: 'osc', arg: e.value ?? 0 })
      : normalizeTriggerValue({ kind: 'drum', velocity: e.velocity ?? 1 });
    this.fireMatchedEffects(this.activeEffectSection(), e, effectInputOf(e), velocity, e.drumId ?? null);
  }

  // --- Effect firing -------------------------------------------------------

  /** The active song section, or null when none is active. */
  private activeEffectSection(): SongSection | null {
    if (this.activeSongId === null || this.activeSectionId === null) return null;
    const song = this.show.songs.find((s) => s.id === this.activeSongId);
    return song?.sections.find((s) => s.id === this.activeSectionId) ?? null;
  }

  /** Fire every Effect of `section` the input matches, in section order. With no active
      section nothing matches, and the input is reported as missed / unrouted. */
  private fireMatchedEffects(
    section: SongSection | null,
    e: InputEvent,
    event: EffectInputEvent,
    velocity: number,
    sourceDrumId: string | null,
  ): void {
    const input = describeInputEvent(e);
    const matched = section ? matchSectionEffects(section, event) : [];
    // A cell's reset input rewinds it BEFORE this fire is narrowed, so a pad that both resets
    // and plays a cell plays its first step.
    const rewound = section ? resetCellSteps(section, event, this.cellSteps) : this.cellSteps;
    const wasReset = rewound !== this.cellSteps;
    this.cellSteps = rewound;
    if (!section || matched.length === 0) {
      if (wasReset) return; // a reset-only message did its job: not a miss
      if (e.kind === 'cc') return; // a CC edge with no Cue is ordinary modulation, not a miss
      if ((e.kind === 'noteOn' || e.kind === 'osc') && !e.drumId) {
        this.onDiagnostic?.({ kind: 'input-unrouted', input });
      } else {
        this.onDiagnostic?.({ kind: 'effect-missed', input, sectionId: section?.id ?? null });
      }
      return;
    }
    const played = pickCellPlay(section, matched, this.cellSteps, () => this.prng.next());
    this.cellSteps = played.steps;
    for (const effect of played.fire) {
      this.fireChainEffect(section, effect, velocity, sourceDrumId, input, effect.trigger.kind);
    }
  }

  /**
   * Audition one Effect of the ACTIVE section by id (`fireEffect`): an authoritative intent,
   * no input re-resolution. A Kit-row Effect fires with no struck drum; a
   * drum-row Effect fires as if its row's drum was hit.
   */
  private processFireEffect(e: InputEvent): void {
    this.fireEffectById(e.effectId ?? '', normalizeTriggerValue({ kind: 'drum', velocity: e.velocity ?? 1 }), describeInputEvent(e));
  }

  /** Fire one Effect of the active section by id, as an audition (`fireEffect`, MIDI-map). */
  private fireEffectById(effectId: string, velocity: number, input: VoiceInputDescriptor): void {
    const section = this.activeEffectSection();
    const effect = section?.effects.find((candidate) => candidate.id === effectId);
    if (!section || !effect) {
      this.onDiagnostic?.({ kind: 'effect-skipped', input, sectionId: section?.id ?? null, effectId, reason: 'no-such-effect' });
      return;
    }
    if (effect.bypass) {
      this.onDiagnostic?.({ kind: 'effect-skipped', input, sectionId: section.id, effectId: effect.id, reason: 'bypassed' });
      return;
    }
    const rowDrum = effect.cell.row === 'kit' ? null : effect.cell.row;
    this.fireChainEffect(section, effect, velocity, rowDrum, input, 'audition');
  }

  // --- MIDI-map (effect chains wave 5) ---------------------------------------

  /**
   * Perform the InputMapping `facet` matches, if any, and report whether the input was
   * CONSUMED (the caller then stops: no zone or Cue sees it). Every mapped
   * input is consumed, whatever its target does. The modulation tables (CC / OSC / note) were
   * already written by the caller, so a Control device can still follow the same knob.
   *
   * `value01` is the input's 0..1 value: a CC's normalised value, an OSC arg, 1 for a
   * note-on and 0 for a note-off.
   *
   * - **Continuous** (`param` / `opacity` / `modifierMix`): the value is stored and written to
   *   the target on the Effect's live voices every frame ({@link applyContinuousMappings}). A
   *   note is a gate: held = `rangeMax`, released = `rangeMin`.
   * - **Discrete** (`fireCell` / `fireEffect` / `recallSection`): a note-on and an `osc`
   *   message fire (like a Cue); a CC fires on its rising edge through 0.5; a note-off
   *   releases the `hold` Effects the target fires. An `oscValue` update never fires.
   * - **`bypass`** is a toggle the web store owns (it sees the input echo); here it is only
   *   consumed.
   */
  private performInputMapping(e: InputEvent, facet: InputMappingEvent, value01: number): boolean {
    if (this.inputMappings.length === 0) return false;
    const mapping = matchInputMapping(this.inputMappings, facet);
    if (!mapping) return false;
    const target = mapping.target;
    const previous = this.mappingValues.get(mapping.id) ?? 0;
    this.mappingValues.set(mapping.id, value01);
    if (isContinuousTarget(target) || target.kind === 'bypass') return true;

    if (e.kind === 'noteOff') {
      for (const effect of this.mappedEffects(mapping)) {
        if (effect.amp.length === 'hold') this.voices.releaseChainVoices(effect.id, this.timeMs, ['hold']);
      }
      return true;
    }
    const fires = e.kind === 'noteOn' || e.kind === 'osc'
      || (e.kind === 'cc' && previous < CC_CUE_THRESHOLD && value01 >= CC_CUE_THRESHOLD);
    if (!fires) return true;

    const input = describeInputEvent(e);
    const velocity = e.kind === 'noteOn'
      ? normalizeTriggerValue({ kind: 'drum', velocity: e.velocity ?? 1 })
      : e.kind === 'osc' ? normalizeTriggerValue({ kind: 'osc', arg: e.value ?? 0 }) : value01;
    switch (target.kind) {
      case 'recallSection': {
        const songId = target.songId
          ?? this.show.songs.find((song) => song.sections.some((s) => s.id === target.sectionId))?.id
          ?? null;
        this.recallTo(songId, target.sectionId);
        return true;
      }
      case 'fireEffect':
        this.fireEffectById(target.effectId, velocity, input);
        return true;
      case 'fireCell': {
        const section = this.activeEffectSection();
        if (!section) return true; // no active section: no cells to fire
        const effects = cellEffects(section, target.cell);
        if (effects.length === 0) {
          this.onDiagnostic?.({ kind: 'effect-missed', input, sectionId: section.id });
          return true;
        }
        const rowDrum = target.cell.row === 'kit' ? null : target.cell.row;
        for (const effect of effects) this.fireChainEffect(section, effect, velocity, rowDrum, input, 'audition');
        return true;
      }
    }
    return true;
  }

  /** The active section's Effects a discrete mapping fires (for a note-off's hold release). */
  private mappedEffects(mapping: InputMapping): Effect[] {
    const section = this.activeEffectSection();
    if (!section) return [];
    const target = mapping.target;
    if (target.kind === 'fireCell') return cellEffects(section, target.cell);
    if (target.kind === 'fireEffect') return section.effects.filter((effect) => effect.id === target.effectId);
    return [];
  }

  /**
   * Write every heard continuous mapping onto the live voices of its Effect, before the
   * per-frame param sweep. The mapping sets the BASE value — `voice.params` (the spawn
   * snapshot the sweep refills from), a modifier link's `params` / `mix`, or the layer
   * `opacity` — so a Control device's modulation on the same param still stacks on top, just
   * as if the card's own knob had been turned. Writing every frame is what makes a knob move
   * reach a voice that is already playing. Allocation-free.
   *
   * Opacity and modifier mix needed no new engine parameter: the voice already carries both
   * per voice (`opacity` from S02's compositor, `mix` on each resolved modifier link), and
   * both are read per frame, so the mapping writes them in place.
   */
  private applyContinuousMappings(): void {
    const bindings = this.continuousBindings;
    for (let b = 0; b < bindings.length; b++) {
      const binding = bindings[b]!;
      const raw = this.mappingValues.get(binding.mappingId);
      if (raw === undefined) continue; // never heard: the authored value stands
      const value = scaleInputMappingValue(raw, binding.rangeMin, binding.rangeMax, binding.lo, binding.hi);
      for (const v of this.voices.pool) {
        if (!v.active || v.chainEffectId !== binding.effectId) continue;
        switch (binding.slot) {
          case 'generator':
            v.params[binding.param] = value;
            break;
          case 'opacity':
            v.opacity = value;
            break;
          case 'modifier': {
            const link = v.modifiers?.[binding.modifierIndex];
            if (link) link.params[binding.param] = value;
            break;
          }
          case 'mix': {
            const link = v.modifiers?.[binding.modifierIndex];
            if (link) link.mix = value;
            break;
          }
        }
      }
    }
  }

  /**
   * Spawn one Effect: apply its retrigger policy, resolve it to a play action through the
   * ONE resolver seam, and spawn that through the unchanged voice pool on the internal bus.
   */
  private fireChainEffect(
    section: SongSection,
    effect: Effect,
    velocity: number,
    sourceDrumId: string | null,
    input: VoiceInputDescriptor | null,
    trigger: Effect['trigger']['kind'] | 'audition',
  ): void {
    const skip = (reason: EffectSkipReason): void => {
      this.onDiagnostic?.({ kind: 'effect-skipped', input, sectionId: section.id, effectId: effect.id, reason });
    };
    if (effect.retrigger === 'ignore' && this.voices.hasLiveChainVoice(effect.id)) {
      skip('retrigger-ignore');
      return;
    }
    const layerOrder = section.effects.indexOf(effect);
    const action = effectPlayAction(effect, { velocity, sourceDrumId, bpm: this.bpm, layerOrder, rng: this.prng });
    if (!action || !this.ensureChainEffectDef(action.effectId)) {
      skip('unknown-generator');
      return;
    }
    // A Splice / Slice member names its own internal def; the pool drops a member whose def is
    // missing, so build each one too (a nested Generator slot would otherwise render blank).
    for (const member of action.spliceInputs ?? []) this.ensureChainEffectDef(member.effectId);
    if (effect.retrigger === 'restart') this.voices.releaseChainVoices(effect.id, this.timeMs);
    this.shapeCascadeVoice(
      this.voices.spawn(action, sourceDrumId, velocity, {
        effectsById: this.chainEffects,
        busById: this.chainBuses,
        latched: this.latched,
        timeMs: this.timeMs,
        bpm: this.bpm,
        pad: `effect:${effect.id}`,
      }),
    );
    this.onDiagnostic?.({ kind: 'effect-fired', input, sectionId: section.id, effectId: effect.id, trigger });
  }

  /** Make sure the internal EffectDef an Effect-path action names exists (lazily built). */
  private ensureChainEffectDef(defId: string): boolean {
    if (this.chainEffects.has(defId)) return true;
    const def = chainEffectDef(defId.slice(defId.indexOf(':') + 1));
    if (!def) return false;
    this.chainEffects.set(defId, def);
    return true;
  }

  /** Fire the active Effect section's Clock Effects whose grid the transport just crossed.
      Runs inside `tick`, after the input queue drains, so it is ordered by the event log. */
  private fireClockEffects(beat: number): void {
    const prev = this.lastClockBeat;
    this.lastClockBeat = beat;
    if (prev === null) return;
    const section = this.activeEffectSection();
    if (!section) return;
    const played = pickCellPlay(section, clockEffectsCrossed(section, prev, beat, this.beatsPerBar), this.cellSteps, () => this.prng.next());
    this.cellSteps = played.steps;
    for (const effect of played.fire) {
      this.fireChainEffect(section, effect, 1, null, null, 'clock');
    }
  }

  // --- tick --------------------------------------------------------------

  tick(now: number, dt: number, transport: TransportState): void {
    const tickStart = perfNow();
    this.timeMs = now;
    this.beat = transport.beat;
    this.bpm = transport.bpm;
    this.beatsPerBar = transport.beatsPerBar;

    this.drainQueue();
    this.fireClockEffects(transport.beat);

    // Advance voice envelopes, then reap dead voices back into the pool. No bus map: every
    // voice plays on the internal poly bus, so a release fades on the voice's own `releaseMs`.
    advanceEnvelopes(this.voices.pool, this.timeMs, NO_BUSES);
    reapDeadVoices(this.voices.pool, this.latched);

    this.advanceLatchedSpliceMotion(dt);

    // Refresh per-voice live params, then composite voices → pixels.
    if (this.model && this.finalFb) {
      this.applyContinuousMappings();
      for (const v of this.voices.pool) {
        if (v.active) applyEffectiveParams(v, this.timeMs, this.bpm, this.ccTable, this.oscTable, this.noteTable, this.audioTable);
      }
      this.compositor.render(
        this.voices.pool,
        this.model,
        { timeMs: this.timeMs, dt, transport, cc: this.ccTable, osc: this.oscTable, notes: this.noteTable, audio: this.audioTable },
        this.finalFb,
      );
      // Section Master chain: over the whole composited frame, before the output stage
      // (blackout / master brightness in `frame()`). Runs once per tick, never per read.
      const master = this.activeEffectSection()?.master;
      if (master?.length) applySectionMaster(this.finalFb, master, this.masterState, { model: this.model, timeMs: this.timeMs, dt });
    }
    this.perf = {
      ...emptyPerfStats(),
      tickMs: perfNow() - tickStart,
      voiceCount: this.voices.pool.reduce((count, v) => count + (v.active ? 1 : 0), 0),
    };
  }

  // --- outputs -----------------------------------------------------------

  /**
   * The composited frame, with the operator output stage applied: panic blackout wins
   * outright, otherwise master brightness scales it.
   *
   * Both act HERE, at the very last step, and never touch voice state — which is what
   * makes a panic instantly reversible (the show has been running underneath the whole
   * time) and what keeps the engine deterministic (the same inputs still produce the
   * same voices; only the emitted pixels differ).
   *
   * Fast path is untouched: with no blackout and unity brightness this returns the
   * composited buffer directly, no copy. Alpha is preserved — only RGB is scaled, so a
   * dimmed frame stays a frame rather than becoming a transparency change.
   */
  frame(): Readonly<Float32Array> {
    if (!this.finalFb) return EMPTY_FRAME;
    const rgba = this.finalFb.rgba;
    if (!this.blackout && this.brightness >= 1) return rgba;

    const out = this.outFb;
    if (!out || out.length !== rgba.length) return rgba; // no scratch (no model) — pass through
    if (this.blackout) {
      out.fill(0);
      // Keep alpha so downstream byte-packing sees a normal opaque frame of black.
      for (let i = 3; i < out.length; i += 4) out[i] = rgba[i]!;
      return out;
    }
    const gain = this.brightness;
    for (let i = 0; i < rgba.length; i += 4) {
      out[i] = rgba[i]! * gain;
      out[i + 1] = rgba[i + 1]! * gain;
      out[i + 2] = rgba[i + 2]! * gain;
      out[i + 3] = rgba[i + 3]!;
    }
    return out;
  }

  stats(): EngineStats {
    // Bus levels are derived from the live voices (effect chains): the summed voice levels per
    // bus, capped at 1 — the same rule the offline Sim's dock meter uses.
    const busLevels: Record<string, number> = {};
    let voiceCount = 0;
    const voices: VoiceStat[] = [];
    for (const v of this.voices.pool) {
      if (!v.active) continue;
      voiceCount++;
      busLevels[v.busId] = Math.min(1, (busLevels[v.busId] ?? 0) + v.level * v.deckGain);
      voices.push({
        id: v.id,
        busId: v.busId,
        effectId: v.effectId,
        mode: v.mode,
        level: v.level * v.deckGain,
        hue: typeof v.params.hue === 'number' ? v.params.hue : 0,
        releasing: v.phase === 'release',
        via: v.via,
        pad: v.pad ?? '',
      });
    }
    return { timeMs: this.timeMs, beat: this.beat, voiceCount, busLevels, voices, perf: this.perf };
  }

}

// ---- Null adapter (test fake) ----------------------------------------------

/**
 * A valid no-op engine: accepts model/show/input, advances nothing visible, and emits
 * an all-zero (black) frame of the right length. Makes the seam real and keeps hosts
 * testable without the full brain.
 */
class NullEngine implements RenderEngine {
  private fb: Float32Array = EMPTY_FRAME;
  private timeMs = 0;
  private beat = 0;
  private activeSongId: string | null = null;
  private activeSectionId: string | null = null;

  setModel(model: PixelModel): void {
    this.fb = new Float32Array(model.pixelCount * 4);
  }
  setShow(show: Show): void {
    const previousSelection: ActiveSelection = {
      activeSongId: this.activeSongId,
      activeSectionId: this.activeSectionId,
    };
    const selection = isValidSelection(show, previousSelection) ? previousSelection : firstSelection(show);
    this.activeSongId = selection.activeSongId;
    this.activeSectionId = selection.activeSectionId;
  }
  applyInput(_ev: InputEvent): void {}
  getActiveSelection(): { activeSongId: string | null; activeSectionId: string | null } {
    return { activeSongId: this.activeSongId, activeSectionId: this.activeSectionId };
  }
  tick(now: number, _dt: number, transport: TransportState): void {
    this.timeMs = now;
    this.beat = transport.beat;
    this.fb.fill(0);
  }
  frame(): Readonly<Float32Array> {
    return this.fb;
  }
  stats(): EngineStats {
    return { timeMs: this.timeMs, beat: this.beat, voiceCount: 0, busLevels: {}, voices: [], perf: emptyPerfStats() };
  }
}

const EMPTY_FRAME = new Float32Array(0);
const NO_BUSES = new Map<string, Bus>();

function emptyPerfStats(): EnginePerfStats {
  return { tickMs: 0, queueMs: 0, pendingMs: 0, envelopeMs: 0, paramsMs: 0, compositeMs: 0, voiceCount: 0 };
}

function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

export function createVoiceBusEngine(opts: RenderEngineOptions = {}): RenderEngine {
  return new VoiceBusEngine(opts.onDiagnostic);
}

export function createNullEngine(): RenderEngine {
  return new NullEngine();
}

// ---- helpers ----------------------------------------------------------------

function describeInputEvent(e: InputEvent): VoiceInputDescriptor {
  return {
    kind: e.kind,
    ...(e.drumId !== undefined ? { drumId: e.drumId } : {}),
    ...(e.zone !== undefined ? { zone: e.zone } : {}),
    ...(e.note !== undefined ? { note: e.note } : {}),
    ...(e.address !== undefined ? { address: e.address } : {}),
    ...(e.value !== undefined ? { value: e.value } : {}),
    ...(e.velocity !== undefined ? { velocity: e.velocity } : {}),
    ...(e.songId !== undefined ? { songId: e.songId } : {}),
    ...(e.sectionId !== undefined ? { sectionId: e.sectionId } : {}),
    ...(e.effectId !== undefined ? { effectId: e.effectId } : {}),
  };
}

/** A CC Cue fires when its controller rises through this normalised value. */
const CC_CUE_THRESHOLD = 0.5;

/**
 * The facets of an input an Effect can match on. The zone slot is the numeric zone string
 * (`"0"`, `"1"`…; the empty legacy zone reads as slot 0); a zone that is not a slot number
 * matches no zone Effect.
 */
function effectInputOf(e: InputEvent): EffectInputEvent {
  const out: EffectInputEvent = {};
  if (e.drumId) {
    out.drumId = e.drumId;
    const slot = e.zone === undefined || e.zone === '' ? 0 : Number(e.zone);
    if (Number.isInteger(slot) && slot >= 0) out.slot = slot;
  }
  if ((e.kind === 'noteOn' || e.kind === 'noteOff') && e.note !== undefined) out.midiNote = e.note;
  if (e.kind === 'osc' && e.address !== undefined) out.oscAddress = e.address;
  return out;
}
