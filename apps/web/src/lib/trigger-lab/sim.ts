/* Production offline adapter. The browser owns relative time, input tables, authored
 * section recall and delayed graph scheduling. Core owns graph evaluation, capped voice
 * allocation/retirement, envelopes, splice motion and all float rendering. This is not a
 * second renderer: render.ts only quantizes this Sim's final frame for the preview.
 * Adjacent modules retain the authoring/tree compatibility exports used by the store. */

import {
  Framebuffer,
  tryGetEffect,
  voice,
  type PixelModel,
  type EffectCategory,
  type EffectTag,
  type PlayType,
} from '@ledrums/core';
import { type EnvMap, type ParamSpec, type ParamValues } from './sim.envelopes';
import { type TriggerGraph } from './sim.graph-compilation';

// Re-export the extracted modules so the public `./sim` API is unchanged.
// `clampUnit` is intentionally NOT re-exported here — it stays an internal cross-module
// helper, preserving the prior public surface byte-for-byte.
export {
  type ParamValue,
  type ParamValues,
  type EnvMap,
  type ParamSpec,
  type EnvKind,
  type EnvPoint,
  type Envelope,
  defaultEnvelope,
  cloneEnvelope,
  type AdsrShape,
  type EaseFn,
  type EaseDir,
  type EaseSpec,
  defaultAdsr,
  adsrToPoints,
  migrateAdsr,
  applyModulations,
  type Mapping,
  type ModSource,
  type ModSampleCtx,
} from './sim.envelopes';
export * from './sim.trigger-source';
export * from './sim.graph-compilation';

// ---- Block tree (branch 2) --------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
/** What a switch routes on. `value` (gate/bands) is the canonical intensity-routing
    mode; the older `velocity` mode was a near-duplicate (even count split on the same
    normalized intensity) and was folded into `value` and removed — see
    {@link foldVelocitySwitch}. `section`/`beat` are count-based and unchanged.
    CANONICAL in core `voice/types.ts` — re-exported here as a type alias (S4.4). */
export type SwitchOn = voice.SwitchOn;
/** Sub-mode of a `value` switch: a single pass/block gate, or N value bands.
    CANONICAL in core `voice/types.ts` — re-exported here as a type alias (S4.4). */
export type ValueMode = voice.ValueMode;
export type Scope = 'drum' | 'kit' | 'hoop';
export type BlockKind = Block['kind'];

interface BlockBase {
  id: string;
}

/** Leaf: an instance of an effect+preset. Every play block owns its params; a preset is
    a snapshot you Apply onto a block or Save from it, never a live binding. */
export interface PlayBlock extends BlockBase {
  kind: 'play';
  mode: PlayMode;
  scope: Scope;
  effectId: string;
  presetId: string;
  /** node-local param values (a preset Apply forks a copy in here). */
  params: ParamValues;
  /** per-param envelope assignment. */
  env: EnvMap;
}
export interface AllBlock extends BlockBase {
  kind: 'all';
  children: Block[];
}
export interface RandomBlock extends BlockBase {
  kind: 'random';
  children: Block[];
  noRepeat: boolean;
}
export interface SequenceBlock extends BlockBase {
  kind: 'sequence';
  children: Block[];
}
export interface SwitchBlock extends BlockBase {
  kind: 'switch';
  on: SwitchOn;
  /** value-switch sub-mode (only meaningful when `on === 'value'`). Optional so a
      block authored before value-mode omits it; {@link treeToGraph} carries it onto
      the graph node and, for `'bands'`, gives each child edge its `band-${i}` handle. */
  valueMode?: ValueMode;
  /** ascending band cutoffs for a `value`+`bands` switch (see {@link GraphNode.bands}). */
  bands?: number[];
  children: Block[];
}
export interface ChanceBlock extends BlockBase {
  kind: 'chance';
  p: number;
  child: Block;
}
export interface ToggleBlock extends BlockBase {
  kind: 'toggle';
  child: Block;
}

export type Block =
  | PlayBlock
  | AllBlock
  | RandomBlock
  | SequenceBlock
  | SwitchBlock
  | ChanceBlock
  | ToggleBlock;

// ---- Effects + presets + buses (branch 1) -----------------------------------

export type Polyphony = 'mono' | 'poly';

export interface EffectDef {
  id: string;
  name: string;
  /**
   * The effect is GENERATOR-BACKED: a voice hosting it delegates rendering to the core
   * {@link EffectGenerator} registered under this id. The server voice path renders it for
   * real output; the offline preview (render.ts) delegates to the SAME core generator.
   * Every selectable effect is generator-backed since the legacy per-pixel pattern path was
   * retired (Effects Library v2, U3).
   */
  generatorId?: string;
  /** Legacy effect category (base/trigger/wash/meter/texture/particle/utility) —
      surfaced so the gallery can group/filter generator effects. */
  category?: EffectCategory;
  /** Gallery card / inspector blurb (from core `metadata.ts`, via the generator seam). */
  description?: string;
  /** Controlled-vocabulary tags — the gallery filters on these (D1). */
  tags?: readonly EffectTag[];
  /** User-facing collection derived from tags (first-match) — the gallery's primary rail
      and the taxonomy the typed play nodes (D3) will share. */
  playType?: PlayType;
  /** When set, the effect is retired: never listed in the gallery (aliases keep shows working). */
  deprecated?: { replacedBy: string; note?: string };
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

// ---- Voices (live instances) ------------------------------------------------

export type VoicePhase = 'attack' | 'sustain' | 'release';

/** View-facing compatibility shape: dock fixtures need not manufacture pool bookkeeping.
 * Actual Sim voices are canonical core voices from VoicePool, never this partial shape. */
type PoolFields = 'active' | 'liveParams' | 'specs' | 'generatorId' | 'genState';
export type Voice = Omit<voice.Voice, PoolFields> & Partial<Pick<voice.Voice, PoolFields>>;

export interface LogEntry {
  t: number;
  pad: string;
  resolved: string[];
}

// ---- Section snapshots (branch 3) -------------------------------------------

export interface Section {
  id: string;
  name: string;
  /** which effect each bus loops when the section loads (null = silent). */
  looks: Record<string, string | null>;
}

// ---- Evaluation actions -----------------------------------------------------
// CANONICAL in core `voice/eval-graph.ts` — imported as type aliases (R17) so any
// drift between this sim and the core evaluator it delegates to fails to compile.
// The former local mirrors + the `as unknown as` bridge casts are gone: the sim's
// runtime eval already IS the core evaluator (R16), so these are the exact action
// shapes `evalGraph`/`evalChildren` return.
type PlayAction = voice.PlayAction;
type Action = voice.Action;
type PlayDraft = voice.PlayDraft;

/** Trigger context — CANONICAL in core `voice/eval-graph.ts` (there `TriggerCtx`,
    re-exported from `@ledrums/core` as `EvalTriggerCtx`). Aliased here so web
    importers keep the `TriggerCtx` name on the `./sim` surface. */
export type TriggerCtx = voice.EvalTriggerCtx;

/** Resolve a param spec list to its default values. */
export function defaultParams(effect: EffectDef): ParamValues {
  const out: ParamValues = {};
  for (const s of effect.params) out[s.key] = s.default;
  return out;
}

export class Sim {
  timeMs = 0;
  beat = 0;
  bpm = 120;
  beatsPerBar = 4;
  /** dt of the most recent tick, ms — read by the offline renderer to build a
      RenderContext for hosted generators (stateful particle/decay effects need it). */
  lastDt = 0;

  buses: Bus[];
  /** Active view of the core slab, in slab order. Mutate authored content through the adapter,
      not this array. Pool identities/seeds/stealing are shared with the connected engine. */
  private activeVoices: voice.Voice[] = [];
  get voices(): readonly voice.Voice[] { return this.activeVoices; }
  private readonly pool = new voice.VoicePool();
  private readonly compositor = voice.createDefaultCompositor();
  private framebuffer: Framebuffer | null = null;
  private tickRevision = 0;
  private renderedRevision = -1;
  private renderedModel: PixelModel | null = null;
  private renderedPresentation = '';
  private renderedGenerators: unknown[] = [];
  private readonly busById = new Map<string, voice.Bus>();
  log: LogEntry[] = [];

  private effectsById = new Map<string, EffectDef>();
  private presets: Preset[];
  private presetsById = new Map<string, Preset>();

  private seqIndex = new Map<string, number>();
  private lastPick = new Map<string, number>();
  private latched = new Map<string, string | null>();
  /** R13 — per-(pad, mix-node) member snapshots for delay-overlap Mix composition. Mirrors
      core `engine.ts` `mixMemberSnapshots`; populated by the core evaluator this Sim delegates
      to, and read by a delayed drain to re-compose with still-live members. */
  private mixMemberSnapshots = new Map<string, voice.MixInputDraft[]>();

  /** Pending-fire queue for delay nodes — mirrors core `engine.ts` `pendingFires`.
      Each entry carries an absolute `fireAtMs` (sim time at enqueue + resolved delayMs)
      and an `enqueueOrder` for stable secondary sort. Drained every `tick()` after
      advancing time. Cleared on `stopAll()` / `clearPendingFires()`. */
  private pendingFires: Array<{
    fireAtMs: number;
    enqueueOrder: number;
    childIds: string[];
    graph: TriggerGraph;
    ctx: TriggerCtx;
    viaPrefix: string;
    seen: Set<string>;
    draft?: PlayDraft | null;
    /** The state prefix in force when this fire was enqueued — restored on drain so the delayed
        branch reads the same sequence/latch buckets (and supersedes the same voices) as the
        immediate part of its own trigger. */
    stateKey: string;
  }> = [];
  private pendingFireCounter = 0;

  /** The eval STATE PREFIX of the fire currently being evaluated — the graph key its caller passed
      to {@link triggerGraph}, or the prefix restored while draining a delayed fire. Ambient for the
      duration of one fire, exactly as `pad` is in the core engine, so voice tagging + delay-overlap
      supersession key on the same prefix the evaluator used. Defaults to the historical `'preview'`
      so a caller that passes no key (tests, ad-hoc previews) behaves exactly as before. */
  private stateKey = 'preview';

  /** Seeded PRNG for random/chance evaluation — the core Mulberry32, mirroring the
      engine's own stream (engine.ts PRNG_SEED pattern). NO ambient Math.random anywhere
      in the eval/render-truth path (item 2): identical input sequences replay exactly. */
  private prng = new voice.Prng(0x1a2b3c4d);

  /**
   * Accumulated motion time per `(pad, splice node)` for `latched` splices — the offline
   * mirror of the engine's own map. Advanced only while a voice for that key is alive, and
   * carried across voices so the movement resumes where the fade left it.
   */
  private spliceMotionMs = new Map<string, number>();

  /** Immutable model revisions supplied by the store. Assignment also releases stale
   * visual state immediately, even while the browser is not rendering. */
  private model: PixelModel | null = null;
  get pixelModel(): PixelModel | null { return this.model; }
  set pixelModel(model: PixelModel | null) {
    this.model = model;
    if (model) for (const v of this.voices) voice.ensureGeometryState(v, model);
  }

  /** Live MIDI CC values, read by the shared compositor alongside OSC/note tables. */
  ccTable = new Map<string, number>();

  /** Live OSC value table — the offline mirror of the core engine's `oscTable`. Keyed by OSC
      address → 0..1. Fed by {@link setOsc} from the store's OSC input path so an OSC-bound
      modulation source previews live; the render sweep reads it per frame via `render.ts`. */
  oscTable = new Map<string, number>();
  noteTable = new Map<string, voice.NoteState>();

  constructor(buses: Bus[], effects: EffectDef[], presets: Preset[]) {
    this.buses = buses;
    for (const e of effects) this.effectsById.set(e.id, e);
    // Reserved fill effect for colour-only splices — registered here exactly as the core
    // engine registers it at `setShow`, so a splice colour previews without the authored
    // effect list carrying a def for it (see core `voice/splice.ts`).
    // Prefer a POLY layer, mirroring the engine: a mono layer makes every new splice voice
    // release the last, which cuts each hoop off as a sequencer moves on.
    const fillBus = buses.find((b) => b.polyphony === 'poly') ?? buses[0];
    this.effectsById.set(voice.SPLICE_FILL_EFFECT_ID, voice.spliceFillEffectDef(fillBus?.id ?? ''));
    this.presets = presets;
    for (const p of presets) this.presetsById.set(p.id, p);
  }

  bus(id: string): Bus | undefined {
    return this.buses.find((b) => b.id === id);
  }
  effect(id: string): EffectDef | undefined {
    return this.effectsById.get(id);
  }
  preset(id: string): Preset | undefined {
    return this.presetsById.get(id);
  }
  effectName(id: string): string {
    return this.effectsById.get(id)?.name ?? id;
  }

  /** Register a runtime-authored effect / preset (the effect creator). */
  registerEffect(e: EffectDef): void {
    this.effectsById.set(e.id, e);
  }
  registerPreset(p: Preset): void {
    this.presetsById.set(p.id, p);
  }
  /** Deregister a preset (preset delete) — drop it from the id-map the resolvers read.
      No effect-unregister: effects are foundational and never deletable. */
  unregisterPreset(id: string): void {
    this.presetsById.delete(id);
  }

  // --- triggering ----------------------------------------------------------

  /** Offline mirror of the engine's sequence-reset application — resolve this input's reset
      bindings (a sequence node's own `resetSource`) and clear each matched node's step state in
      the sim's buckets, via the SAME core module the engine uses. Returns the matched bindings
      for the caller's monitor lines. Correct offline keys require callers to fire with the graph
      key as the state prefix (see {@link triggerGraph}). */
  applySequenceResets(graphs: Record<string, TriggerGraph>, input: voice.ResetInput): voice.ResetHit[] {
    return voice.applySequenceResets(this.seqIndex, graphs, input);
  }

  /** Fire a freeform trigger graph: evaluate from the trigger node, spawn/stop. */
  triggerGraph(padLabel: string, graph: TriggerGraph, ctx: TriggerCtx, stateKey?: string): string[] {
    this.stateKey = stateKey ?? padLabel;
    const actions = this.evalGraph(graph, ctx, this.stateKey);
    const resolved: string[] = [];
    for (const a of actions) {
      if (a.kind === 'stop') {
        const v = this.voices.find((x) => x.id === a.voiceId);
        if (v) {
          this.release(v);
          resolved.push(`■ stop ${this.effectName(v.effectId)} (${a.via})`);
        }
      } else if (a.kind === 'pending') {
        this.enqueueCorePending(a.descriptor);
      } else if (a.kind === 'play') {
        const v = this.spawn(a, ctx.sourceDrumId, ctx.velocity);
        if (v) resolved.push(`▶ ${this.modeGlyph(a.mode)} ${this.effectName(a.effectId)} → ${this.busName(v.busId)}  (${a.via})`);
      }
    }
    if (resolved.length === 0) resolved.push('— nothing (chance/empty/unwired)');
    this.log.unshift({ t: this.timeMs, pad: padLabel, resolved });
    if (this.log.length > 60) this.log.length = 60;
    return resolved;
  }

  private evalGraph(graph: TriggerGraph, ctx: TriggerCtx, stateKey: string): Action[] {
    // ONE evaluator: delegate to the pure core Gen3 evaluator. A raw legacy graph is
    // normalized to Gen3 first, exactly as the real engine does at `setShow` — so the
    // offline preview and live output share a single evaluation path.
    //
    // `stateKey` is the eval STATE PREFIX, and callers pass the GRAPH KEY so it lines up with the
    // real engine's (`engine.resolveHitGraphs` uses the graph key / `key#slotIndex`). It used to be
    // the constant `'preview'`, which pooled every graph's sequence/random/toggle state into one
    // bucket — two graphs' sequencers advanced each other offline. Tests that pass no key keep
    // their own label.
    const g = graph.version === 3 ? graph : voice.normalizeTriggerGraphToGen3(graph).graph;
    return voice.evalGraph(this.coreEvalState(), g, stateKey, ctx);
  }

  private coreEvalState(): voice.EvalState {
    return {
      seqIndex: this.seqIndex,
      lastPick: this.lastPick,
      latched: this.latched,
      prng: this.prng,
      presetsById: this.presetsById as Map<string, voice.Preset>,
      isVoiceAlive: (id: string) => this.pool.isVoiceAlive(id),
      mixMemberSnapshots: this.mixMemberSnapshots,
      isLayerLive: (pad, originNodeId) => this.isLayerLive(pad, originNodeId),
    };
  }

  /** Origin-keyed layer liveness for R13 delay-overlap Mix composition — the offline mirror
      of core `VoicePool.isLayerLive`. A member is live while a voice spawned under `pad`
      still carries its origin (as its own producer or as a Mix member). */
  private isLayerLive(pad: string, originNodeId: string): boolean {
    return this.pool.isLayerLive(pad, originNodeId);
  }

  private enqueueCorePending(descriptor: voice.PendingDescriptor): void {
    this.pendingFires.push({
      fireAtMs: this.timeMs + descriptor.relativeDelayMs,
      enqueueOrder: this.pendingFireCounter++,
      childIds: descriptor.childIds,
      graph: descriptor.graph,
      ctx: descriptor.ctx,
      viaPrefix: descriptor.viaPrefix,
      seen: descriptor.seen,
      draft: descriptor.draft,
      stateKey: this.stateKey,
    });
  }

  // --- voice lifecycle -----------------------------------------------------

  private syncBuses(): void {
    this.busById.clear();
    for (const bus of this.buses) this.busById.set(bus.id, bus);
  }

  private spawn(a: PlayAction, sourceDrumId: string | null = null, velocity = 1): voice.Voice | null {
    this.syncBuses();
    const v = this.pool.spawn(a, sourceDrumId, velocity, {
      effectsById: this.effectsById, busById: this.busById, latched: this.latched,
      timeMs: this.timeMs, bpm: this.bpm, pad: this.stateKey,
    });
    voice.shapeCascadeVoice(v, this.pixelModel);
    this.activeVoices = this.pool.pool.filter((v) => v.active);
    return v;
  }

  private release(v: voice.Voice): void {
    voice.releaseVoice(v, this.timeMs);
  }

  stopBus(busId: string): void {
    for (const v of this.voices) if (v.busId === busId) this.release(v);
  }
  stopAll(): void {
    for (const v of this.voices) this.release(v);
    this.clearPendingFires();
    this.mixMemberSnapshots.clear();
  }

  /** Discard all enqueued deferred fires — call when authored content changes so
      stale pending fires from the previous show/graph cannot materialise. Mirrors
      core `engine.ts` `setShow()` clearing `this.pendingFires = []`. */
  clearPendingFires(): void {
    this.pendingFires = [];
    this.pendingFireCounter = 0;
  }

  /** Update the CC table from a raw MIDI CC (value 0..127). Writes both the specific-channel
      key and the omni slot, matching the core engine's `processEvent` — so an omni mapping
      (channel filter off) always reads the latest value regardless of the sending channel. */
  setCc(controller: number, value: number, channel: number | null): void {
    const v = voice.ccValue01(value);
    this.ccTable.set(voice.ccKey(controller, channel), v);
    this.ccTable.set(voice.ccKey(controller, null), v);
  }

  /** Update the OSC table from a raw OSC value at `address` (clamped to 0..1), mirroring the
      core engine's `processEvent` OSC-table write so an `osc` modulation source previews live. */
  setOsc(address: string, value: number): void {
    this.oscTable.set(address, voice.oscValue01(value));
  }

  setNote(note: number, velocity: number, channel: number | null, on: boolean): void {
    const v = voice.noteValue01(velocity / 127);
    const write = (ch: number | null): void => {
      const key = voice.noteKey(note, ch);
      const prev = this.noteTable.get(key);
      this.noteTable.set(key, on ? { gate: 1, velocity: v, releasedAtMs: null } : { gate: prev?.gate ?? 0, velocity: prev?.velocity ?? 0, releasedAtMs: this.timeMs });
    };
    write(channel);
    write(null);
  }

  // --- pending-fire drain (mirrors core engine.ts drainPendingFires) ----------

  /** Drain pending delay fires whose `fireAtMs ≤ this.timeMs`, in stable
      `(fireAtMs, enqueueOrder)` order. Re-enters the core Gen3 evaluator on each child so
      nested delays re-enqueue and the cycle guard (seen-set) is preserved. The descriptor's
      graph is always Gen3 — it was produced by the core evaluator that enqueued this fire. */
  private drainPendingFires(): void {
    if (this.pendingFires.length === 0) return;
    const due = this.pendingFires.filter((f) => f.fireAtMs <= this.timeMs);
    if (due.length === 0) return;
    this.pendingFires = this.pendingFires.filter((f) => f.fireAtMs > this.timeMs);
    due.sort((a, b) => a.fireAtMs - b.fireAtMs || a.enqueueOrder - b.enqueueOrder);
    for (const f of due) {
      const { graph, childIds, ctx, viaPrefix, seen, draft } = f;
      this.stateKey = f.stateKey;
      const actions = voice.evalChildren(this.coreEvalState(), graph, this.stateKey, childIds, ctx, viaPrefix, seen, draft ?? null);
      for (const a of actions) {
        if (a.kind === 'stop') {
          const v = this.voices.find((x) => x.id === a.voiceId);
          if (v) this.release(v);
        } else if (a.kind === 'play') {
          this.spawn(a, ctx.sourceDrumId, ctx.velocity);
        } else {
          this.enqueueCorePending(a.descriptor);
        }
      }
    }
  }

  // --- tick ----------------------------------------------------------------

  tick(dtMs: number): void {
    this.tickRevision++;
    this.timeMs += dtMs;
    this.lastDt = dtMs;
    this.beat += (dtMs / 60000) * this.bpm;

    this.drainPendingFires();
    this.syncBuses();
    voice.advanceEnvelopes(this.pool.pool, this.timeMs, this.busById);
    voice.reapDeadVoices(this.pool.pool, this.latched);
    voice.advanceLatchedSpliceMotion(this.pool.pool, this.spliceMotionMs, dtMs);
    this.activeVoices = this.pool.pool.filter((v) => v.active);
  }

  /** 0..1 progress through a voice's life — drives param envelopes. */
  voicePhase(v: Voice): number {
    return voice.voicePhase(v, this.timeMs);
  }

  /** Offline float render: the core compositor owns generation, scope, modifiers and
   * composite math. Buffers/caches belong to this Sim, never module-global preview state.
   * The browser may repaint a paused tick or request an immediate hit preview between ticks.
   * Clean paints reuse the frame. Dirty paints re-evaluate from the SAME pre-render
   * checkpoint, replacing (not cumulatively advancing) this tick's visual state. This
   * includes public tempo/input table writes and live canvas registry replacements.
   * Effect/preset upserts are spawn-time definitions; existing voice params stay snapshots.
   * Newly spawned voices start at level zero and become visible on the next tick. */
  render(model: PixelModel): Readonly<Float32Array> {
    // These adapter inputs are public, so setter-only revision counters are insufficient.
    // Do not serialize voices/opaque render state: only small presentation input tables.
    const presentation = JSON.stringify([this.timeMs, this.beat, this.bpm, this.beatsPerBar,
      [...this.ccTable], [...this.oscTable], [...this.noteTable], this.voices.map((v) => v.id)]);
    const generators: unknown[] = [];
    const collect = (v: voice.GeometryState & { generatorId?: string | null }): void => {
      generators.push(v.generatorId ? tryGetEffect(v.generatorId) : undefined);
      for (const member of v.mixInputs ?? []) collect(member);
      for (const member of v.spliceInputs ?? []) collect(member);
    };
    for (const v of this.voices) collect(v);
    if (this.framebuffer && this.renderedRevision === this.tickRevision && this.renderedModel === model &&
      this.renderedPresentation === presentation && generators.length === this.renderedGenerators.length &&
      generators.every((g, i) => g === this.renderedGenerators[i])) return this.framebuffer.rgba;
    if (!this.framebuffer || this.framebuffer.pixelCount !== model.pixelCount) this.framebuffer = new Framebuffer(model.pixelCount);
    for (const v of this.voices) voice.applyEffectiveParams(v, this.timeMs, this.bpm, this.ccTable, this.oscTable, this.noteTable);
    const bar = Math.floor(this.beat / this.beatsPerBar);
    this.compositor.renderPresentation(this.pool.pool, model, {
      timeMs: this.timeMs, dt: this.lastDt,
      transport: { timeMs: this.timeMs, beat: this.beat, bar, beatInBar: this.beat - bar * this.beatsPerBar,
        bpm: this.bpm, beatsPerBar: this.beatsPerBar, playing: true },
      cc: this.ccTable, osc: this.oscTable, notes: this.noteTable,
    }, this.framebuffer, this.tickRevision);
    this.renderedRevision = this.tickRevision;
    this.renderedModel = model;
    this.renderedPresentation = presentation;
    this.renderedGenerators = generators;
    return this.framebuffer.rgba;
  }

  // --- section recall (branch 3) -------------------------------------------

  private lookAction(effectId: string, via: string): PlayAction | null {
    const effect = this.effect(effectId);
    if (!effect) return null;
    const params = this.preset(`${effectId}:default`)?.params ?? defaultParams(effect);
    return { kind: 'play', effectId, mode: 'loop', scope: 'kit', busId: '', params, via, latchKey: null };
  }

  /** Recall a section as a timed morph — releases the old look loops and spawns
      the new ones, riding the bus crossfade/voice-stealing (no hard cut). */
  recallSection(section: Section): void {
    for (const bus of this.buses) {
      const effectId = section.looks[bus.id] ?? null;
      for (const v of this.voices) {
        if (v.busId === bus.id && v.mode !== 'oneshot') this.release(v);
      }
      if (!effectId) continue;
      const a = this.lookAction(effectId, `Section: ${section.name}`);
      if (!a) continue;
      this.spawn(a);
    }
  }

  // --- viz helpers ---------------------------------------------------------

  voiceLevel(v: Voice): number {
    return v.level * v.deckGain;
  }
  busVoices(busId: string): Voice[] {
    return this.voices.filter((v) => v.busId === busId);
  }
  busLevel(busId: string): number {
    const bus = this.bus(busId);
    const vs = this.busVoices(busId);
    if (vs.length === 0) return 0;
    if (bus?.polyphony === 'mono') return Math.max(...vs.map((v) => this.voiceLevel(v)));
    return Math.min(1, vs.reduce((s, v) => s + this.voiceLevel(v), 0));
  }

  private busName(id: string): string {
    return this.bus(id)?.name ?? id;
  }
  private modeGlyph(m: PlayMode): string {
    return m === 'oneshot' ? '⚡' : m === 'loop' ? '∞' : '⊓';
  }
}
