/**
 * Outer seam — the host ↔ brain interface for the trigger-graph / voice-bus lighting
 * model. {@link RenderEngine} is the small, host-facing surface; behind it sit graph
 * eval, an object-pooled voice store, transport-driven envelopes, and the inner
 * {@link Compositor} seam (voices → pixels). Ported from `trigger-lab/sim.ts`.
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
import { cloneEnvelope } from './envelope';
import { Prng } from './prng';
import {
  buildPixelAttrs,
  createDefaultCompositor,
  applyEffectiveParams,
  type Compositor,
  type PixelAttrs,
} from './compositor';
import {
  emptyShow,
  padKey,
  type Bus,
  type EffectDef,
  type EnvMap,
  type GraphNode,
  type ParamSpec,
  type ParamValues,
  type PlayMode,
  type Preset,
  type Scope,
  type Section,
  type Show,
  type SwitchOn,
  type TriggerGraph,
  type Voice,
} from './types';

// ---- Public seam ------------------------------------------------------------

export interface InputEvent {
  kind: 'noteOn' | 'noteOff' | 'osc' | 'key' | 'recallSection';
  drumId?: string;
  zone?: string;
  note?: number;
  velocity?: number;
  address?: string;
  value?: number;
  /** recallSection: activate a song's section so hits fire its slot graphs. */
  songId?: string;
  sectionId?: string;
  timeMs: number;
}

export interface EngineStats {
  timeMs: number;
  beat: number;
  voiceCount: number;
  busLevels: Record<string, number>;
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

// ---- Eval actions (engine-internal) -----------------------------------------

interface PlayAction {
  kind: 'play';
  effectId: string;
  mode: PlayMode;
  scope: Scope;
  /** layer/bus override ('' → the effect's default bus). */
  busId: string;
  params: ParamValues;
  env: EnvMap;
  via: string;
  latchKey: string | null;
}
interface StopAction {
  kind: 'stop';
  voiceId: string;
  via: string;
}
type Action = PlayAction | StopAction;

interface TriggerCtx {
  velocity: number;
  sectionIndex: number;
  sectionCount: number;
  beatPhase: number;
  sourceDrumId: string;
}

const VOICE_CAP = 256;
const PRNG_SEED = 0x1a2b3c4d;

// ---- Production adapter ------------------------------------------------------

/**
 * The production brain. Owns: a time-stamped input queue (drained at tick), graph
 * eval → actions, an object-pooled voice store, transport-driven voice envelopes, and
 * the inner compositor. `frame()` returns the final framebuffer's rgba (no copy).
 */
class VoiceBusEngine implements RenderEngine {
  private model: PixelModel | null = null;
  private attrs: PixelAttrs | null = null;
  private finalFb: Framebuffer | null = null;
  private readonly compositor: Compositor = createDefaultCompositor();

  private show: Show = emptyShow();
  private busById = new Map<string, Bus>();
  private effectsById = new Map<string, EffectDef>();
  private presetsById = new Map<string, Preset>();

  // Object-pooled voices. `pool` is fixed-size; `active` marks occupancy.
  private readonly pool: Voice[] = [];
  private voiceSeq = 0;

  // Per-node graph eval state (keyed by `${statePrefix}#${nodeId}`, where the prefix
  // is a per-slot or pad key, so layers/pads don't collide).
  private seqIndex = new Map<string, number>();
  private lastPick = new Map<string, number>();
  private latched = new Map<string, string | null>();

  private prng = new Prng(PRNG_SEED);

  private queue: InputEvent[] = [];
  private timeMs = 0;
  private beat = 0;
  private bpm = 120;
  private sectionIndex = 0;

  /**
   * Active song/section for slot-aware hit resolution. Set via `recallSection`
   * input events (queued + drained deterministically, never mutated outside the
   * queue drain). `setShow` seeds from the first song/section and clears on
   * show change so stale ids don't resolve against a new arrangement.
   */
  private activeSongId: string | null = null;
  private activeSectionId: string | null = null;

  constructor() {
    for (let i = 0; i < VOICE_CAP; i++) this.pool.push(makeVoiceSlot());
  }

  // --- lifecycle ---------------------------------------------------------

  setModel(model: PixelModel): void {
    this.model = model;
    this.attrs = buildPixelAttrs(model);
    this.finalFb = new Fb(model.pixelCount);
  }

  setShow(show: Show): void {
    this.show = show;
    this.busById = new Map(show.buses.map((b) => [b.id, b] as const));
    this.effectsById = new Map(show.effects.map((e) => [e.id, e] as const));
    this.presetsById = new Map(show.presets.map((p) => [p.id, p] as const));
    // Authored content changed: clear live state so eval starts clean & deterministic.
    for (const v of this.pool) v.active = false;
    this.seqIndex.clear();
    this.lastPick.clear();
    this.latched.clear();
    this.sectionIndex = 0;
    this.prng.reseed(PRNG_SEED);
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
      return;
    }
    // noteOn / key both fire a pad's graph; noteOff currently has no engine effect
    // (voices decay on their own envelope). osc with only an address is unmapped.
    if (e.kind === 'noteOn' || e.kind === 'key' || e.kind === 'osc') {
      const drumId = e.drumId;
      if (!drumId) return;
      const zone = e.zone ?? '';
      const velocity = clamp01(e.kind === 'osc' ? e.value ?? 0 : e.velocity ?? 1);
      const ctx: TriggerCtx = {
        velocity,
        sectionIndex: this.sectionIndex,
        sectionCount: this.show.sections.length,
        beatPhase: this.beatPhase(),
        sourceDrumId: drumId,
      };
      // Section-aware resolution: fire each non-null slot graph for THIS pad.
      // Slots are keyed per (drum, zone) by padKey, so a hit fires only the active
      // section's graphs for the struck pad — Edge, Rim and Centre each fire their
      // own slot graph. Fallback to the flat padKey graph when there is no active
      // section or this pad has no slots in the active section.
      const toFire = this.resolveHitGraphs(drumId, zone);
      for (const { graph, statePrefix } of toFire) {
        this.fireGraph(graph, statePrefix, ctx);
      }
    }
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
  private resolveHitGraphs(drumId: string, zone: string): Array<{ graph: TriggerGraph; statePrefix: string }> {
    const pad = padKey(drumId, zone);
    if (this.activeSongId !== null && this.activeSectionId !== null && this.show.songs) {
      const song = this.show.songs.find((s) => s.id === this.activeSongId);
      const section = song?.sections.find((s) => s.id === this.activeSectionId);
      if (section) {
        const slots = section.slots[pad];
        if (slots) {
          const resolved: Array<{ graph: TriggerGraph; statePrefix: string }> = [];
          for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            const key = slots[slotIndex];
            if (!key) continue;
            const g = this.show.graphs[key];
            // Prefix is per-slot POSITION, not the bare graph key: two slots holding
            // the SAME key in one section must run as INDEPENDENT layers (own
            // sequence/random/toggle/latch state), so fold in the slot index. Cross-
            // section reuse stays stable — slot 0 of any section shares one state key.
            if (g) resolved.push({ graph: g, statePrefix: `${key}#${slotIndex}` });
          }
          if (resolved.length > 0) return resolved;
        }
      }
    }
    const g = this.show.graphs[pad];
    return g ? [{ graph: g, statePrefix: pad }] : [];
  }

  private beatPhase(): number {
    return this.beat - Math.floor(this.beat);
  }

  // --- graph eval (ported from sim.evalGraph/evalNode) -------------------

  private fireGraph(graph: TriggerGraph, pad: string, ctx: TriggerCtx): void {
    const actions = this.evalGraph(graph, pad, ctx);
    for (const a of actions) {
      if (a.kind === 'stop') {
        const v = this.findActiveVoice(a.voiceId);
        if (v) this.release(v);
      } else {
        this.spawn(a, ctx.sourceDrumId, ctx.velocity);
      }
    }
  }

  private evalGraph(graph: TriggerGraph, pad: string, ctx: TriggerCtx): Action[] {
    const trig = graph.nodes.find((n) => n.kind === 'trigger');
    if (!trig) return [];
    return this.evalNode(graph, pad, trig, ctx, '', new Set());
  }

  /** A node's wired children, ordered top→bottom (visual y) for determinism. */
  private childrenOf(graph: TriggerGraph, node: GraphNode): GraphNode[] {
    return graph.edges
      .filter((e) => e.from === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => a.y - b.y);
  }

  private nodeStateKey(pad: string, nodeId: string): string {
    return `${pad}#${nodeId}`;
  }

  private evalNode(
    graph: TriggerGraph,
    pad: string,
    node: GraphNode,
    ctx: TriggerCtx,
    viaPrefix: string,
    seen: Set<string>,
  ): Action[] {
    if (seen.has(node.id)) return []; // cycle guard
    const seen2 = new Set(seen).add(node.id);
    const label = (s: string): string => (viaPrefix ? `${viaPrefix} → ${s}` : s);
    const kids = this.childrenOf(graph, node);
    const sk = this.nodeStateKey(pad, node.id);
    switch (node.kind) {
      case 'trigger':
        return kids.flatMap((c) => this.evalNode(graph, pad, c, ctx, viaPrefix, seen2));
      case 'play':
        if (!node.effectId) return [];
        return [
          {
            kind: 'play',
            effectId: node.effectId,
            mode: node.mode,
            scope: node.scope,
            busId: node.busId,
            params: this.resolveNodeParams(node),
            env: node.env,
            via: label(modeWord(node.mode)),
            latchKey: null,
          },
        ];
      case 'all':
        return kids.flatMap((c) => this.evalNode(graph, pad, c, ctx, label('All'), seen2));
      case 'random': {
        if (kids.length === 0) return [];
        let i = this.prng.nextInt(kids.length);
        if (node.noRepeat && kids.length > 1) {
          const prev = this.lastPick.get(sk);
          while (i === prev) i = this.prng.nextInt(kids.length);
        }
        this.lastPick.set(sk, i);
        return this.evalNode(graph, pad, kids[i]!, ctx, label(`Random[${i + 1}/${kids.length}]`), seen2);
      }
      case 'sequence': {
        if (kids.length === 0) return [];
        const i = (this.seqIndex.get(sk) ?? 0) % kids.length;
        this.seqIndex.set(sk, i + 1);
        return this.evalNode(graph, pad, kids[i]!, ctx, label(`Seq[${i + 1}/${kids.length}]`), seen2);
      }
      case 'switch': {
        if (kids.length === 0) return [];
        const i = switchIndexN(kids.length, node.on, ctx);
        return this.evalNode(graph, pad, kids[i]!, ctx, label(`Switch:${node.on}[${i + 1}]`), seen2);
      }
      case 'chance': {
        if (this.prng.next() > node.p) return [];
        return kids.flatMap((c) =>
          this.evalNode(graph, pad, c, ctx, label(`Chance ${Math.round(node.p * 100)}%`), seen2),
        );
      }
      case 'toggle': {
        const current = this.latched.get(sk);
        const alive = current ? this.isVoiceAlive(current) : false;
        if (alive && current) {
          this.latched.set(sk, null);
          return [{ kind: 'stop', voiceId: current, via: label('Toggle off') }];
        }
        const actions = kids.flatMap((c) => this.evalNode(graph, pad, c, ctx, label('Toggle on'), seen2));
        const firstPlay = actions.find((a): a is PlayAction => a.kind === 'play');
        if (firstPlay) firstPlay.latchKey = sk;
        return actions;
      }
    }
  }

  private resolveNodeParams(node: GraphNode): ParamValues {
    if (node.linked) return this.presetsById.get(node.presetId)?.params ?? node.params;
    return node.params;
  }

  // --- voice lifecycle (object-pooled; ported from sim.spawn/release/tick) ----

  private spawn(a: PlayAction, sourceDrumId: string | null, velocity: number): Voice | null {
    const effect = this.effectsById.get(a.effectId);
    if (!effect) return null;
    const bus = this.busById.get(a.busId || effect.busId);
    if (!bus) return null;

    if (bus.polyphony === 'mono') {
      for (const v of this.pool) {
        if (v.active && v.busId === bus.id && v.phase !== 'release') this.release(v);
      }
    }

    const slot = this.acquireSlot();
    if (!slot) return null;

    slot.active = true;
    slot.id = `v${++this.voiceSeq}`;
    slot.effectId = a.effectId;
    slot.pattern = effect.pattern;
    slot.busId = bus.id;
    slot.mode = a.mode;
    slot.scope = a.scope;
    slot.sourceDrumId = sourceDrumId;
    slot.velocity = velocity;
    // Generator-backed effects host a legacy EffectGenerator; the compositor reads
    // `generatorId` + `genState`. Reset state on (re)spawn so a reused pool slot never
    // inherits a previous voice's accumulation buffers / RNG cursor.
    slot.generatorId = effect.generatorId ?? null;
    slot.genState = null;
    slot.params = { ...a.params };
    slot.specs = effect.params;
    slot.env = cloneEnvMap(a.env);
    slot.attackMs = effect.attackMs;
    slot.sustainMs = effect.sustainMs;
    slot.releaseMs = effect.releaseMs;
    slot.phase = 'attack';
    slot.level = 0;
    slot.bornAtMs = this.timeMs;
    slot.releaseAtMs = null;
    slot.releaseFromLevel = 1;
    slot.via = a.via;
    slot.deckGain = 1;

    if (a.latchKey) this.latched.set(a.latchKey, slot.id);
    return slot;
  }

  /**
   * Find a free pool slot; if the pool is saturated, steal the oldest releasing
   * voice, else the oldest voice overall (voice-capped, no GC churn).
   */
  private acquireSlot(): Voice | null {
    let free: Voice | null = null;
    let oldestReleasing: Voice | null = null;
    let oldest: Voice | null = null;
    for (const v of this.pool) {
      if (!v.active) {
        free = v;
        break;
      }
      if (v.phase === 'release' && (!oldestReleasing || v.bornAtMs < oldestReleasing.bornAtMs)) {
        oldestReleasing = v;
      }
      if (!oldest || v.bornAtMs < oldest.bornAtMs) oldest = v;
    }
    return free ?? oldestReleasing ?? oldest;
  }

  private release(v: Voice): void {
    if (v.phase === 'release') return;
    v.phase = 'release';
    v.releaseAtMs = this.timeMs;
    v.releaseFromLevel = v.level;
  }

  private findActiveVoice(id: string): Voice | null {
    for (const v of this.pool) if (v.active && v.id === id) return v;
    return null;
  }
  private isVoiceAlive(id: string): boolean {
    return this.findActiveVoice(id) != null;
  }

  // --- tick --------------------------------------------------------------

  tick(now: number, dt: number, transport: TransportState): void {
    this.timeMs = now;
    this.beat = transport.beat;
    this.bpm = transport.bpm;
    this.sectionIndex = this.show.sections.length > 0 ? transport.bar % this.show.sections.length : 0;

    this.drainQueue();

    // Advance voice envelopes (ported from sim.tick).
    for (const v of this.pool) {
      if (!v.active) continue;
      const age = this.timeMs - v.bornAtMs;
      if (v.phase === 'attack') {
        v.level = v.attackMs <= 0 ? 1 : Math.min(1, age / v.attackMs);
        if (v.level >= 1) v.phase = 'sustain';
      } else if (v.phase === 'sustain') {
        if (v.mode === 'oneshot') {
          v.level = 1;
          if (age >= v.attackMs + v.sustainMs) this.release(v);
        } else {
          v.level = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(age / 480));
        }
      } else {
        const bus = this.busById.get(v.busId);
        const ramp = Math.max(60, v.mode === 'oneshot' ? v.releaseMs : bus?.crossfadeMs ?? v.releaseMs);
        const since = this.timeMs - (v.releaseAtMs ?? this.timeMs);
        v.level = Math.max(0, v.releaseFromLevel * (1 - since / ramp));
      }
    }

    // Reap dead voices back into the pool (no allocation, no array churn).
    for (const v of this.pool) {
      if (v.active && v.phase === 'release' && v.level <= 0.001) {
        v.active = false;
        // Clear any latch still pointing at this voice.
        for (const [k, id] of this.latched) if (id === v.id) this.latched.set(k, null);
      }
    }

    // Refresh per-voice live params, then composite voices → pixels.
    if (this.model && this.attrs && this.finalFb) {
      for (const v of this.pool) {
        if (v.active) applyEffectiveParams(v, this.timeMs, this.bpm);
      }
      this.compositor.render(this.pool, this.model, this.attrs, { timeMs: this.timeMs, dt, transport }, this.finalFb);
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
    for (const v of this.pool) if (v.active) voiceCount++;
    return { timeMs: this.timeMs, beat: this.beat, voiceCount, busLevels };
  }

  private busLevel(bus: Bus): number {
    let count = 0;
    let sum = 0;
    let mx = 0;
    for (const v of this.pool) {
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

// ---- Section recall reference (kept for parity / future host use) ------------
// (Section morph from sim.recallSection is intentionally not auto-driven yet;
//  sectionIndex tracking above feeds switch:section. Wiring is host work.)

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
    return { timeMs: this.timeMs, beat: this.beat, voiceCount: 0, busLevels: {} };
  }
}

const EMPTY_FRAME = new Float32Array(0);

export function createVoiceBusEngine(): RenderEngine {
  return new VoiceBusEngine();
}

export function createNullEngine(): RenderEngine {
  return new NullEngine();
}

// ---- helpers ----------------------------------------------------------------

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function modeWord(m: PlayMode): string {
  return m === 'oneshot' ? 'One-shot' : m === 'loop' ? 'Loop' : 'Hold';
}

function switchIndexN(n: number, on: SwitchOn, ctx: TriggerCtx): number {
  let frac = 0;
  if (on === 'velocity') frac = ctx.velocity;
  else if (on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
  else if (on === 'beat') frac = ctx.beatPhase;
  return Math.min(n - 1, Math.floor(frac * n));
}

function cloneEnvMap(env: EnvMap): EnvMap {
  const out: EnvMap = {};
  for (const k of Object.keys(env)) out[k] = cloneEnvelope(env[k]!);
  return out;
}

/** Pre-allocated voice pool slot (inactive). */
function makeVoiceSlot(): Voice {
  return {
    active: false,
    id: '',
    effectId: '',
    pattern: 'flash',
    busId: '',
    mode: 'oneshot',
    scope: 'kit',
    sourceDrumId: null,
    velocity: 1,
    generatorId: null,
    genState: null,
    params: {},
    liveParams: {},
    specs: EMPTY_SPECS,
    env: {},
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
    phase: 'attack',
    level: 0,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 1,
    via: '',
    deckGain: 1,
  };
}

const EMPTY_SPECS: ParamSpec[] = [];
