/**
 * Outer seam — the host ↔ brain interface for the trigger-graph / voice-bus lighting
 * model. {@link RenderEngine} is the small, host-facing surface; behind it sit graph
 * eval (`eval-graph.ts`), an object-pooled voice store (`voice-pool.ts`), transport-
 * driven envelopes (`envelope-tick.ts`), and the inner {@link Compositor} seam
 * (voices → pixels). Ported from `trigger-lab/sim.ts`.
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
import {
  evalGraph,
  evalChildren,
  type Action,
  type PlayAction,
  type EvalState,
  type TriggerCtx,
  type PendingDescriptor,
} from './eval-graph';
import { VoicePool, releaseVoice } from './voice-pool';
import { advanceEnvelopes, reapDeadVoices } from './envelope-tick';
import { ccKey, ccValue01, oscValue01 } from './modulation';
import {
  emptyShow,
  normalizeTriggerValue,
  padKey,
  type Bus,
  type EffectDef,
  type ParamValues,
  type PlayMode,
  type Preset,
  type Show,
  type TriggerGraph,
  type TriggerSource,
} from './types';
import type {
  GraphMissReason,
  GraphResolutionPath,
  VoiceDiagnosticSink,
  VoiceInputDescriptor,
} from './diagnostics';

// ---- Public seam ------------------------------------------------------------

export interface InputEvent {
  kind: 'noteOn' | 'noteOff' | 'osc' | 'key' | 'recallSection' | 'fireGraph' | 'cc';
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
  /** recallSection: activate a song's section so hits fire its slot graphs. */
  songId?: string;
  sectionId?: string;
  /** fireGraph: the exact graph key to play — an authoritative intent, not a source to
      re-resolve. The keyboard performance path (keys 1–9) sends this so the engine plays
      precisely the graph the client chose, with no zone-map / direct both-fire ambiguity. */
  graphKey?: string;
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
}

export interface EngineStats {
  timeMs: number;
  beat: number;
  voiceCount: number;
  busLevels: Record<string, number>;
  /** Per-voice detail for a connected client's dock (S17). Empty when no voices are active. */
  voices: VoiceStat[];
}

export interface RenderEngine {
  setModel(model: PixelModel): void;
  setShow(show: Show): void;
  applyInput(ev: InputEvent): void;
  tick(now: number, dt: number, transport: TransportState): void;
  /** composited RGBA, stride 4, no copy. */
  frame(): Readonly<Float32Array>;
  stats(): EngineStats;
}

export interface RenderEngineOptions {
  onDiagnostic?: VoiceDiagnosticSink;
}

const PRNG_SEED = 0x1a2b3c4d;

interface ResolvedGraph {
  graphKey: string;
  graph: TriggerGraph;
  statePrefix: string;
  path: GraphResolutionPath;
}

// ---- Production adapter ------------------------------------------------------

/**
 * The production brain. Owns: a time-stamped input queue (drained at tick), graph
 * eval → actions, an object-pooled voice store, transport-driven voice envelopes, and
 * the inner compositor. `frame()` returns the final framebuffer's rgba (no copy).
 */
class VoiceBusEngine implements RenderEngine {
  constructor(private readonly onDiagnostic?: VoiceDiagnosticSink) {}

  private model: PixelModel | null = null;
  private finalFb: Framebuffer | null = null;
  private readonly compositor: Compositor = createDefaultCompositor();

  private show: Show = emptyShow();
  private busById = new Map<string, Bus>();
  private effectsById = new Map<string, EffectDef>();
  private presetsById = new Map<string, Preset>();

  // Object-pooled voices (fixed-size slab; `acquire`/`release`/`spawn` in voice-pool.ts).
  private readonly voices = new VoicePool();

  // Per-node graph eval state (keyed by `${statePrefix}#${nodeId}`, where the prefix
  // is a per-slot or pad key, so layers/pads don't collide).
  private seqIndex = new Map<string, number>();
  private lastPick = new Map<string, number>();
  private latched = new Map<string, string | null>();

  private prng = new Prng(PRNG_SEED);

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
   * modulation source each frame. An OSC event both fires trigger graphs AND feeds this table,
   * so the same address can drive a trigger and modulate params.
   */
  private oscTable = new Map<string, number>();

  private queue: InputEvent[] = [];
  private timeMs = 0;
  private beat = 0;
  private bpm = 120;
  private sectionIndex = 0;

  /**
   * Pending-fire queue for delay nodes. Each entry holds an absolute `fireAtMs`
   * (computed at enqueue from `timeMs + relativeDelayMs`) and an `enqueueOrder`
   * counter for stable secondary sorting. Drained in `tick()` after `drainQueue()`.
   * Cleared on `setShow()` so a fresh show starts with no lingering deferred fires.
   */
  private pendingFires: Array<{
    fireAtMs: number;
    enqueueOrder: number;
    descriptor: PendingDescriptor;
  }> = [];
  private pendingFireCounter = 0;

  /**
   * Active song/section for slot-aware hit resolution. Set via `recallSection`
   * input events (queued + drained deterministically, never mutated outside the
   * queue drain). `setShow` seeds from the first song/section and clears on
   * show change so stale ids don't resolve against a new arrangement.
   */
  private activeSongId: string | null = null;
  private activeSectionId: string | null = null;

  // --- lifecycle ---------------------------------------------------------

  setModel(model: PixelModel): void {
    this.model = model;
    this.finalFb = new Fb(model.pixelCount);
  }

  setShow(show: Show): void {
    this.show = show;
    this.busById = new Map(show.buses.map((b) => [b.id, b] as const));
    this.effectsById = new Map(show.effects.map((e) => [e.id, e] as const));
    this.presetsById = new Map(show.presets.map((p) => [p.id, p] as const));
    // Authored content changed: clear live state so eval starts clean & deterministic.
    this.voices.reset();
    this.seqIndex.clear();
    this.lastPick.clear();
    this.latched.clear();
    this.sectionIndex = 0;
    this.prng.reseed(PRNG_SEED);
    this.pendingFires = [];
    this.pendingFireCounter = 0;
    this.ccTable.clear(); // S37: fresh show → no lingering CC values
    this.oscTable.clear(); // fresh show → no lingering OSC values
    // Seed active section from the first song/section (a recallSection event can
    // override this immediately after; here we just ensure a clean non-null start).
    this.activeSongId = show.songs?.[0]?.id ?? null;
    this.activeSectionId = show.songs?.[0]?.sections[0]?.id ?? null;
  }

  // --- input -------------------------------------------------------------

  applyInput(ev: InputEvent): void {
    this.queue.push(ev);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    const due = this.queue.filter((e) => e.timeMs <= this.timeMs);
    this.queue = this.queue.filter((e) => e.timeMs > this.timeMs);
    due.sort((a, b) => a.timeMs - b.timeMs);
    for (const e of due) this.processEvent(e);
  }

  private processEvent(e: InputEvent): void {
    if (e.kind === 'recallSection') {
      // Activate a section so subsequent hits fire its slot graphs (layered).
      this.activeSongId = e.songId ?? null;
      this.activeSectionId = e.sectionId ?? null;
      this.onDiagnostic?.({
        kind: 'section-recalled',
        songId: this.activeSongId,
        sectionId: this.activeSectionId,
      });
      // Spawn/release this section's base "looks" (the per-bus loop effects) so the
      // engine's output finally matches the offline sim at the root. See spawnSectionLooks.
      this.spawnSectionLooks(this.activeSectionId);
      return;
    }
    if (e.kind === 'fireGraph') {
      this.processFireGraph(e);
      return;
    }
    if (e.kind === 'cc') {
      // Update the CC value table (S37): write the normalized 0..1 value under BOTH the
      // specific-channel key and the omni key, so an omni mapping (channel filter off) always
      // reads the latest regardless of the sending channel. Deterministic: state only ever
      // changes here, on the drained event log.
      const controller = e.controller ?? 0;
      const value01 = ccValue01(e.value ?? 0);
      this.ccTable.set(ccKey(controller, e.channel ?? null), value01);
      this.ccTable.set(ccKey(controller, null), value01);
      return;
    }
    // An OSC event ALSO feeds the OSC value table (an `osc` modulation source reads its address
    // here) in addition to firing trigger graphs below — deterministic: state only changes here.
    if (e.kind === 'osc' && e.address !== undefined) {
      this.oscTable.set(e.address, oscValue01(e.value ?? 0));
    }

    // noteOn / key / osc fire trigger graphs; noteOff currently has no engine effect
    // (voices decay on their own envelope).
    if (e.kind !== 'noteOn' && e.kind !== 'key' && e.kind !== 'osc') return;

    // The normalized 0..1 value that drives eval (ctx.velocity), via the ONE seam every
    // source feeds so the switch `value` mode routes identically. At this boundary MIDI
    // note-velocity is already 0..1 (the server divided by 127 through the same seam), so
    // a key/noteOn hit passes through as a `drum` fire; OSC carries its raw arg.
    const value =
      e.kind === 'osc'
        ? normalizeTriggerValue({ kind: 'osc', arg: e.value ?? 0 })
        : normalizeTriggerValue({ kind: 'drum', velocity: e.velocity ?? 1 });

    // A zone-mapped hit fires its pad graph(s), and raw-addressable inputs (MIDI/OSC)
    // also remain available to trigger-node `source` bindings. This lets a MIDI note
    // drive a patch zone and an authored effect/trigger graph without needing to remove
    // the note from the patch input map.
    const toFire = this.resolveGraphsForEvent(e);
    const input = describeInputEvent(e);
    if (toFire.length === 0) {
      // A raw MIDI/OSC message that claimed no zone (no drumId attached by the server's
      // zone-map) AND matched no direct graph source is genuinely UNROUTED — flag it apart
      // from a routed drum hit whose section just holds no graph (`graph-missed`).
      if ((e.kind === 'noteOn' || e.kind === 'osc') && !e.drumId) {
        this.onDiagnostic?.({ kind: 'input-unrouted', input });
      } else {
        this.onDiagnostic?.({ kind: 'graph-missed', input, reason: this.missReasonFor(e) });
      }
      return;
    }

    const ctx: TriggerCtx = {
      velocity: value,
      sectionIndex: this.sectionIndex,
      sectionCount: this.show.sections.length,
      beatPhase: this.beatPhase(),
      sourceDrumId: e.drumId ?? '',
      bpm: this.bpm,
    };
    for (const resolved of toFire) {
      this.onDiagnostic?.({
        kind: 'input-resolved',
        input,
        path: resolved.path,
        graphKey: resolved.graphKey,
        statePrefix: resolved.statePrefix,
      });
      this.fireGraph(resolved, ctx, input);
    }
  }

  /**
   * Fire an EXPLICIT graph by key — the keyboard performance intent (`fireGraph` input).
   * The graph key is authoritative: no source re-resolution, no zone-map, no direct/pad
   * both-fire. The client already chose which graph (the n-th of its active section); the
   * engine plays exactly that one, ONCE. Emits the same `input-resolved` / `graph-fired`
   * diagnostics as any other fire, or `graph-missed` (`no-such-graph`) when the key is stale.
   *
   * `sourceDrumId` is derived from the graph's own authored `drum` trigger source so drum-
   * scoped effects target the right drum (matching the offline sim); a midi/osc-sourced graph
   * carries no drum here — identical to the server's existing direct-binding path.
   */
  private processFireGraph(e: InputEvent): void {
    const input = describeInputEvent(e);
    const key = e.graphKey;
    const graph = key ? this.show.graphs[key] : undefined;
    if (!key || !graph) {
      this.onDiagnostic?.({ kind: 'graph-missed', input, reason: 'no-such-graph' });
      return;
    }
    const src = triggerSourceOf(graph);
    const ctx: TriggerCtx = {
      velocity: normalizeTriggerValue({ kind: 'drum', velocity: e.velocity ?? 1 }),
      sectionIndex: this.sectionIndex,
      sectionCount: this.show.sections.length,
      beatPhase: this.beatPhase(),
      sourceDrumId: src?.kind === 'drum' ? src.drumId : '',
      bpm: this.bpm,
    };
    const resolved: ResolvedGraph = { graphKey: key, graph, statePrefix: key, path: 'fire-graph' };
    this.onDiagnostic?.({
      kind: 'input-resolved',
      input,
      path: resolved.path,
      graphKey: resolved.graphKey,
      statePrefix: resolved.statePrefix,
    });
    this.fireGraph(resolved, ctx, input);
  }

  private resolveGraphsForEvent(e: InputEvent): ResolvedGraph[] {
    const out: ResolvedGraph[] = [];
    if (e.drumId) out.push(...this.resolveHitGraphs(e.drumId, e.zone ?? ''));
    if (e.kind === 'noteOn' || e.kind === 'osc') out.push(...this.resolveDirectGraphs(e));
    return out;
  }

  /**
   * DIRECT trigger-source resolution. Matches each
   * authored graph's trigger-node `source` against the raw input: a MIDI note event fires
   * graphs whose source is `{ kind:'midi', note }`; an OSC event fires `{ kind:'osc',
   * address }`. `drum` sources are pad-bound and never match here (they fire via the
   * padKey path). The state prefix is the graph KEY, so each direct-bound graph keeps its
   * own deterministic eval state. Pure + deterministic (iterates a stable key order).
   *
   * CC sources await a CC input event — there is no CC `InputEvent` kind yet, so only
   * `note` sources are reachable from a raw MIDI note here.
   */
  private resolveDirectGraphs(e: InputEvent): ResolvedGraph[] {
    const out: ResolvedGraph[] = [];
    for (const [key, graph] of Object.entries(this.show.graphs)) {
      const src = triggerSourceOf(graph);
      if (!src) continue;
      const match =
        e.kind === 'osc'
          ? src.kind === 'osc' && e.address !== undefined && src.address === e.address
          : src.kind === 'midi' && src.note !== undefined && src.note === e.note;
      if (match) out.push({ graphKey: key, graph, statePrefix: key, path: e.kind === 'osc' ? 'direct-osc' : 'direct-midi' });
    }
    return out;
  }

  /**
   * Resolve which graphs to fire for a (drumId, zone) hit.
   *
   * Slots are keyed per pad by padKey `"drumId:zone"` (the same identity `graphs`
   * uses), so resolution is a direct `section.slots[padKey(drumId, zone)]` lookup —
   * each zone of a drum fires ITS OWN slot graphs. If the active section has non-null
   * slot entries for this pad, returns one entry per filled slot, each with a per-slot-
   * POSITION state prefix (`${key}#${slotIndex}`) so layered graphs from the same hit —
   * even two slots holding the SAME graph key — get distinct PRNG/sequence/latch state
   * and don't interfere with each other.
   *
   * Falls back to the flat `graphs[padKey(drumId, zone)]` graph when:
   *  - no active section / song is set, OR
   *  - the active section has no slots for this pad, OR
   *  - all slots are null (unassigned).
   * The fallback restores the pre-section per-zone behaviour exactly.
   */
  private resolveHitGraphs(drumId: string, zone: string): ResolvedGraph[] {
    const pad = padKey(drumId, zone);
    if (this.activeSongId !== null && this.activeSectionId !== null && this.show.songs) {
      const song = this.show.songs.find((s) => s.id === this.activeSongId);
      const section = song?.sections.find((s) => s.id === this.activeSectionId);
      if (section) {
        const slots = section.slots[pad];
        if (slots) {
          const resolved: ResolvedGraph[] = [];
          for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            const key = slots[slotIndex];
            if (!key) continue;
            const g = this.show.graphs[key];
            // Prefix is per-slot POSITION, not the bare graph key: two slots holding
            // the SAME key in one section must run as INDEPENDENT layers (own
            // sequence/random/toggle/latch state), so fold in the slot index. Cross-
            // section reuse stays stable — slot 0 of any section shares one state key.
            if (g) resolved.push({ graphKey: key, graph: g, statePrefix: `${key}#${slotIndex}`, path: 'pad-section' });
          }
          if (resolved.length > 0) return resolved;
        }
      }
    }
    const g = this.show.graphs[pad];
    return g ? [{ graphKey: pad, graph: g, statePrefix: pad, path: 'pad-fallback' }] : [];
  }

  private missReasonFor(e: InputEvent): GraphMissReason {
    if (!e.drumId) return 'no-direct-match';
    const pad = padKey(e.drumId, e.zone ?? '');
    if (this.activeSongId === null || this.activeSectionId === null || !this.show.songs) {
      return this.show.graphs[pad] ? 'no-direct-match' : 'no-active-section';
    }
    const song = this.show.songs.find((s) => s.id === this.activeSongId);
    const section = song?.sections.find((s) => s.id === this.activeSectionId);
    const slots = section?.slots[pad];
    if (!slots || slots.every((key) => !key || !this.show.graphs[key])) {
      return this.show.graphs[pad] ? 'no-direct-match' : 'no-slot-graphs';
    }
    return 'no-pad-fallback';
  }

  private beatPhase(): number {
    return this.beat - Math.floor(this.beat);
  }

  // --- section looks (spawn/release on recall) ---------------------------
  //
  // A section's `looks` name one loop effect per bus that plays while the section is
  // active. Recalling a section mirrors the offline sim (`sim.recallSection`)
  // STRUCTURALLY so connected (engine) and offline (sim) output agree: iterate buses in
  // show order, release each bus's prior non-oneshot voices, then — where the section
  // names a look for that bus — spawn that effect as a looped, kit-scoped voice.
  // Deterministic (no RNG; the play action is fixed given section + effect + preset) and
  // non-stacking (release precedes spawn, so a repeated recall replaces rather than
  // accumulates). Oneshot voices are never section-managed — they decay on their own
  // envelope. A null/absent look releases the bus but spawns nothing, so a section with
  // empty looks is a pure release (a no-op when there is nothing to release).

  private spawnSectionLooks(sectionId: string | null): void {
    if (sectionId === null) return;
    const section = this.show.sections.find((s) => s.id === sectionId);
    if (!section) return;
    for (const bus of this.show.buses) {
      const effectId = section.looks[bus.id] ?? null;
      for (const v of this.voices.pool) {
        if (v.active && v.busId === bus.id && v.mode !== 'oneshot') releaseVoice(v, this.timeMs);
      }
      if (!effectId) continue;
      const action = this.lookAction(effectId, `Section: ${section.name}`);
      if (!action) continue;
      this.voices.spawn(action, null, 1, {
        effectsById: this.effectsById,
        busById: this.busById,
        latched: this.latched,
        timeMs: this.timeMs,
      });
    }
  }

  /** The looped play action for one section look — the effect's default-preset params
      (or its spec defaults), kit scope, on the effect's own bus (`''` resolves to
      `effect.busId` in the pool spawn), no latch. Null for an unknown effect. Mirrors
      the sim's `lookAction`. */
  private lookAction(effectId: string, via: string): PlayAction | null {
    const effect = this.effectsById.get(effectId);
    if (!effect) return null;
    const params = this.presetsById.get(`${effectId}:default`)?.params ?? this.lookDefaultParams(effect);
    return { kind: 'play', effectId, mode: 'loop', scope: 'kit', busId: '', params, via, latchKey: null };
  }

  /** Default param record from an effect's spec — the fallback when no
      `${effectId}:default` preset exists. Typed to the voice `ParamValues`
      (number | bool), mirroring the sim's `defaultParams(effect)`. */
  private lookDefaultParams(effect: EffectDef): ParamValues {
    const out: ParamValues = {};
    for (const s of effect.params) out[s.key] = s.default;
    return out;
  }

  // --- graph eval (delegated to eval-graph.ts) ---------------------------

  /** The engine-owned eval state bundle handed to the pure graph evaluator. Built per
      fire so it always sees the current `presetsById` (reassigned on `setShow`). */
  private evalState(): EvalState {
    return {
      seqIndex: this.seqIndex,
      lastPick: this.lastPick,
      latched: this.latched,
      prng: this.prng,
      presetsById: this.presetsById,
      isVoiceAlive: (id) => this.voices.isVoiceAlive(id),
    };
  }

  private fireGraph(resolved: ResolvedGraph, ctx: TriggerCtx, input: VoiceInputDescriptor): void {
    const actions = evalGraph(this.evalState(), resolved.graph, resolved.statePrefix, ctx);
    const playEffects = actions
      .filter((a): a is PlayAction => a.kind === 'play')
      .map((a) => a.effectId);
    this.onDiagnostic?.({
      kind: 'graph-fired',
      input,
      path: resolved.path,
      graphKey: resolved.graphKey,
      statePrefix: resolved.statePrefix,
      actionCount: actions.length,
      playEffects,
    });
    this.applyActions(actions, ctx);
  }

  /**
   * Apply a flat action list produced by graph eval (or by draining a pending fire).
   * `PlayAction`s spawn voices; `StopAction`s release them; `PendingAction`s enqueue a
   * deferred fire at `timeMs + relativeDelayMs`. Shared between the immediate fire path
   * (`fireGraph`) and the drain path (`drainPendingFires`) so nested delays work
   * identically to immediate fires.
   */
  private applyActions(actions: Action[], ctx: TriggerCtx): void {
    for (const a of actions) {
      if (a.kind === 'stop') {
        const v = this.voices.findActiveVoice(a.voiceId);
        if (v) releaseVoice(v, this.timeMs);
      } else if (a.kind === 'pending') {
        this.enqueuePendingFire(a.descriptor);
      } else {
        this.voices.spawn(a, ctx.sourceDrumId, ctx.velocity, {
          effectsById: this.effectsById,
          busById: this.busById,
          latched: this.latched,
          timeMs: this.timeMs,
        });
      }
    }
  }

  /** Enqueue a pending fire from a delay node. `fireAtMs` is absolute (engine timeMs +
      relative delay) and is snapshot-stable — the bpm at enqueue is already baked into
      `relativeDelayMs` inside the descriptor. */
  private enqueuePendingFire(descriptor: PendingDescriptor): void {
    this.pendingFires.push({
      fireAtMs: this.timeMs + descriptor.relativeDelayMs,
      enqueueOrder: this.pendingFireCounter++,
      descriptor,
    });
  }

  /**
   * Drain pending fires whose `fireAtMs ≤ this.timeMs`. Called in `tick()` right after
   * `drainQueue()`. Fires are processed in ascending (fireAtMs, enqueueOrder) order for
   * stable determinism across ticks. Each drained fire re-enters the SAME eval path via
   * `evalChildren` + `applyActions`, so nested delays re-enqueue correctly and the
   * cycle/seen-set guard from the original eval is preserved.
   */
  private drainPendingFires(): void {
    if (this.pendingFires.length === 0) return;
    const due = this.pendingFires.filter((f) => f.fireAtMs <= this.timeMs);
    if (due.length === 0) return;
    this.pendingFires = this.pendingFires.filter((f) => f.fireAtMs > this.timeMs);
    due.sort((a, b) => a.fireAtMs - b.fireAtMs || a.enqueueOrder - b.enqueueOrder);
    for (const f of due) {
      const { graph, pad, ctx, childIds, viaPrefix, seen } = f.descriptor;
      const actions = evalChildren(this.evalState(), graph, pad, childIds, ctx, viaPrefix, seen);
      this.applyActions(actions, ctx);
    }
  }

  // --- tick --------------------------------------------------------------

  tick(now: number, dt: number, transport: TransportState): void {
    this.timeMs = now;
    this.beat = transport.beat;
    this.bpm = transport.bpm;
    this.sectionIndex = this.show.sections.length > 0 ? transport.bar % this.show.sections.length : 0;

    this.drainQueue();
    this.drainPendingFires();

    // Advance voice envelopes, then reap dead voices back into the pool.
    advanceEnvelopes(this.voices.pool, this.timeMs, this.busById);
    reapDeadVoices(this.voices.pool, this.latched);

    // Refresh per-voice live params, then composite voices → pixels.
    if (this.model && this.finalFb) {
      for (const v of this.voices.pool) {
        if (v.active) applyEffectiveParams(v, this.timeMs, this.bpm, this.ccTable, this.oscTable);
      }
      this.compositor.render(
        this.voices.pool,
        this.model,
        { timeMs: this.timeMs, dt, transport, cc: this.ccTable, osc: this.oscTable },
        this.finalFb,
      );
    }
  }

  // --- outputs -----------------------------------------------------------

  frame(): Readonly<Float32Array> {
    if (this.finalFb) return this.finalFb.rgba;
    return EMPTY_FRAME;
  }

  stats(): EngineStats {
    const busLevels: Record<string, number> = {};
    for (const b of this.show.buses) busLevels[b.id] = this.busLevel(b);
    let voiceCount = 0;
    const voices: VoiceStat[] = [];
    for (const v of this.voices.pool) {
      if (!v.active) continue;
      voiceCount++;
      voices.push({
        id: v.id,
        busId: v.busId,
        effectId: v.effectId,
        mode: v.mode,
        level: v.level * v.deckGain,
        hue: typeof v.params.hue === 'number' ? v.params.hue : 0,
        releasing: v.phase === 'release',
        via: v.via,
      });
    }
    return { timeMs: this.timeMs, beat: this.beat, voiceCount, busLevels, voices };
  }

  private busLevel(bus: Bus): number {
    let count = 0;
    let sum = 0;
    let mx = 0;
    for (const v of this.voices.pool) {
      if (!v.active || v.busId !== bus.id) continue;
      const lvl = v.level * v.deckGain;
      count++;
      sum += lvl;
      if (lvl > mx) mx = lvl;
    }
    if (count === 0) return 0;
    return bus.polyphony === 'mono' ? mx : Math.min(1, sum);
  }
}

// ---- Section recall ----------------------------------------------------------
// A recallSection input now drives the section morph directly (spawnSectionLooks above),
// structurally mirroring sim.recallSection so connected + offline output match; the
// sectionIndex tracking in tick() still feeds switch:section for count-based routing.

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

  setModel(model: PixelModel): void {
    this.fb = new Float32Array(model.pixelCount * 4);
  }
  setShow(_show: Show): void {}
  applyInput(_ev: InputEvent): void {}
  tick(now: number, _dt: number, transport: TransportState): void {
    this.timeMs = now;
    this.beat = transport.beat;
    this.fb.fill(0);
  }
  frame(): Readonly<Float32Array> {
    return this.fb;
  }
  stats(): EngineStats {
    return { timeMs: this.timeMs, beat: this.beat, voiceCount: 0, busLevels: {}, voices: [] };
  }
}

const EMPTY_FRAME = new Float32Array(0);

export function createVoiceBusEngine(opts: RenderEngineOptions = {}): RenderEngine {
  return new VoiceBusEngine(opts.onDiagnostic);
}

export function createNullEngine(): RenderEngine {
  return new NullEngine();
}

// ---- helpers ----------------------------------------------------------------

/** A trigger graph's declared input source — the `trigger` node's `source`, or undefined
    for a graph authored before the source model / with none bound. Mirrors the web sim. */
function triggerSourceOf(graph: TriggerGraph): TriggerSource | undefined {
  return graph.nodes.find((n) => n.kind === 'trigger')?.source;
}

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
    ...(e.graphKey !== undefined ? { graphKey: e.graphKey } : {}),
  };
}

// `bandIndex` lives in eval-graph.ts (graph eval owns band resolution). Re-exported here
// so the public `./engine` import surface — which the engine tests consume — is unchanged.
export { bandIndex } from './eval-graph';
