/* =============================================================================
   TRIGGER LAB — throwaway simulation.  NOT the engine, NOT production.

   Decides three branches before committing the core model:
     1. Voice model  — layers-as-buses with a mono/poly polyphony rule.
     2. Block set    — a trigger behavior-tree (Wwise/FMOD-style containers).
     3. Section change — timed morph (rides the bus crossfade/voice-stealing).

   An effect (e.g. Swirl) has parameters + named presets; a placed clip is an
   INSTANCE of effect+preset that owns its params — a preset is a snapshot you
   Apply onto a clip or Save from it, never a live binding. Params can be driven by envelopes over a
   voice's life. Voices are abstract "lights" (a pattern + params + envelope).
   Delete this whole directory once the branches are decided.

   STRUCTURE (S3.3 split): this core file holds the Block-tree model, the
   effect/preset/bus/voice/section types, and the `Sim` class (voice lifecycle +
   graph evaluation). The cohesive sub-concerns live alongside and are
   re-exported below so the public `./sim` surface is unchanged:
     - `./sim.envelopes`         — ADSR shapes/sampling + param primitives.
     - `./sim.trigger-source`    — TriggerSource matching + value normalization.
     - `./sim.graph-compilation` — trigger-graph types, block→graph, velocity fold.
   ============================================================================= */

import { voice, type BlendMode, type EffectCategory, type EffectTag, type PlayType, type ResolvedModifier } from '@ledrums/core';
import { type EnvMap, type Mapping, type ParamSpec, type ParamValues } from './sim.envelopes';
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
  ENV_KINDS,
  type EnvPoint,
  type Envelope,
  envShape,
  presetPoints,
  defaultEnvelope,
  cloneEnvelope,
  type AdsrShape,
  type EaseFn,
  type EaseDir,
  type EaseSpec,
  defaultAdsr,
  adsrToPoints,
  sampleEnvelope,
  migrateAdsr,
  ease,
  applyModulations,
  envelopeToMapping,
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

export const CONTAINER_KINDS: BlockKind[] = ['all', 'random', 'sequence', 'switch'];
export const MODIFIER_KINDS: BlockKind[] = ['chance', 'toggle'];

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

export interface Voice {
  id: string;
  effectId: string;
  busId: string;
  mode: PlayMode;
  scope: Scope;
  /** Raw targetId from the play node — resolved to a pixel range by the renderer.
   *  Encoding: drum = drumId; hoop = `"<drumId>#<hoopIndex>"`. Absent = auto. */
  targetId?: string;
  sourceDrumId: string | null;
  /** hit velocity 0..1 at spawn — drives a hosted generator's synthetic trigger. */
  velocity: number;
  /** per-trigger RNG seed (item C) — mirrors the core Voice field; derived at spawn so
      random-look generator effects differ per fire yet replay exactly. */
  seed: number;
  /** hosted legacy-generator id (offline preview delegates to the core generator), or
      null for a pattern voice. Mirrors the core Voice field. */
  generatorId?: string | null;
  /** per-voice generator state (from the core EffectGenerator's createState) — built
      lazily by the offline renderer and persisted for the voice's life. */
  genState?: unknown;
  /** resolved modifier chain (mirrors the core Voice field) — applied by the offline
      renderer between render and blend. Resolved from graph topology at spawn (S29). */
  modifiers?: ResolvedModifier[];
  /** per-voice, per-modifier state (parallel to `modifiers`), built lazily by the chain
      runner and reset per voice — mirrors `genState`. */
  modState?: unknown[];
  /** resolved modulation mappings onto this voice's effect params (doc 10) — mirrors the
      core Voice field; applied by the offline renderer's param sweep. Populated from graph
      topology at spawn (S34). */
  modulations?: Mapping[];
  mixBlendMode?: BlendMode;
  mixInputs?: voice.MixInput[];
  /** resolved param snapshot at spawn. */
  params: ParamValues;
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
  /** Eval state prefix this voice was spawned under (always `'preview'` in the sim) — scopes
      origin-keyed liveness for R13 delay-overlap Mix composition. Mirrors the core Voice field. */
  pad?: string;
  /** Graph node that produced this voice's layer — read by the sim's `isLayerLive` mirror so a
      delayed branch composes with still-live Mix members. Mirrors the core Voice field. */
  originNodeId?: string;
}

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

/** Per-trigger voice seed — the core VoicePool recipe (same base constant). */
function deriveSeedFromCounter(counter: number): number {
  return voice.deriveSeed(0x1ed5eed5, counter);
}

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
  voices: Voice[] = [];
  /** Per-instance monotonic voice counter (ids + per-trigger seeds). Instance-scoped so two
      Sims fed identical inputs replay identically — a shared module counter would not. */
  private voiceSeq = 0;
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
  }> = [];
  private pendingFireCounter = 0;

  /** Seeded PRNG for random/chance evaluation — the core Mulberry32, mirroring the
      engine's own stream (engine.ts PRNG_SEED pattern). NO ambient Math.random anywhere
      in the eval/render-truth path (item 2): identical input sequences replay exactly. */
  private prng = new voice.Prng(0x1a2b3c4d);

  /** Live MIDI CC value table (S37) — the offline mirror of the core engine's `ccTable`.
      Keyed by controller+channel → 0..1 (see core `ccKey`). Fed by {@link setCc} from the
      store's WebMIDI forward so the preview tracks CC exactly like the connected engine; the
      render sweep reads it per frame via `render.ts` `modCtxFor`. */
  ccTable = new Map<string, number>();

  /** Live OSC value table — the offline mirror of the core engine's `oscTable`. Keyed by OSC
      address → 0..1. Fed by {@link setOsc} from the store's OSC input path so an OSC-bound
      modulation source previews live; the render sweep reads it per frame via `render.ts`. */
  oscTable = new Map<string, number>();
  noteTable = new Map<string, voice.NoteState>();

  constructor(buses: Bus[], effects: EffectDef[], presets: Preset[]) {
    this.buses = buses;
    for (const e of effects) this.effectsById.set(e.id, e);
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

  /** Fire a freeform trigger graph: evaluate from the trigger node, spawn/stop. */
  triggerGraph(padLabel: string, graph: TriggerGraph, ctx: TriggerCtx): string[] {
    const actions = this.evalGraph(graph, ctx);
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

  private evalGraph(graph: TriggerGraph, ctx: TriggerCtx): Action[] {
    // ONE evaluator: delegate to the pure core Gen3 evaluator. A raw legacy graph is
    // normalized to Gen3 first, exactly as the real engine does at `setShow` — so the
    // offline preview and live output share a single evaluation path.
    const g = graph.version === 3 ? graph : voice.normalizeTriggerGraphToGen3(graph).graph;
    return voice.evalGraph(this.coreEvalState(), g, 'preview', ctx);
  }

  private coreEvalState(): voice.EvalState {
    return {
      seqIndex: this.seqIndex,
      lastPick: this.lastPick,
      latched: this.latched,
      prng: this.prng,
      presetsById: this.presetsById as Map<string, voice.Preset>,
      isVoiceAlive: (id: string) => this.voices.some((v) => v.id === id),
      mixMemberSnapshots: this.mixMemberSnapshots,
      isLayerLive: (pad, originNodeId) => this.isLayerLive(pad, originNodeId),
    };
  }

  /** Origin-keyed layer liveness for R13 delay-overlap Mix composition — the offline mirror
      of core `VoicePool.isLayerLive`. A member is live while a voice spawned under `pad`
      still carries its origin (as its own producer or as a Mix member). */
  private isLayerLive(pad: string, originNodeId: string): boolean {
    return this.voices.some(
      (v) => v.pad === pad && (v.originNodeId === originNodeId || !!v.mixInputs?.some((mi) => mi.originNodeId === originNodeId)),
    );
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
    });
  }

  // --- voice lifecycle -----------------------------------------------------

  private spawn(a: PlayAction, sourceDrumId: string | null = null, velocity = 1): Voice | null {
    const effect = this.effect(a.effectId);
    if (!effect) return null;
    const bus = this.bus(a.busId || effect.busId);
    if (!bus) return null;

    if (bus.polyphony === 'mono') {
      for (const v of this.voices) {
        if (v.busId === bus.id && v.phase !== 'release') this.release(v);
      }
    }

    // B1 — a delayed Mix re-composition supersedes the prior still-live composite at the same
    // (pad, originNodeId): release it so their shared members aren't composited twice. Mirrors
    // core `VoicePool.spawn`; release the oldest still-live match (see S2 for the multi-instance
    // aliasing note). Immediate/`delay 0` spawns never set the flag, so multiplicity is untouched.
    if (a.supersedePriorVoice && a.originNodeId) {
      let prior: Voice | null = null;
      for (const v of this.voices) {
        if (v.phase === 'release') continue;
        if (v.pad !== 'preview' || v.originNodeId !== a.originNodeId) continue;
        if (!prior || v.bornAtMs < prior.bornAtMs) prior = v;
      }
      if (prior) this.release(prior);
    }

    // per-trigger seed (item C) — same recipe as the core VoicePool, so random-look
    // generator effects differ per fire yet replay exactly given the same inputs.
    // Computed BEFORE the literal: the local `voice` shadows the core namespace inside it.
    const seed = deriveSeedFromCounter(this.voiceSeq + 1);
    const voice: Voice = {
      id: `v${++this.voiceSeq}`,
      effectId: a.effectId,
      busId: bus.id,
      mode: a.mode,
      scope: a.scope,
      targetId: a.targetId,
      sourceDrumId,
      velocity,
      seed,
      generatorId: effect.generatorId ?? null,
      genState: null,
      mixInputs: a.mixInputs?.map((input, index): voice.MixInput | null => {
        const inputEffect = this.effect(input.effectId);
        if (!inputEffect?.generatorId) return null;
        return {
          generatorId: inputEffect.generatorId,
          scope: input.scope,
          targetId: input.targetId,
          sourceDrumId,
          velocity,
          seed: (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0,
          params: { ...input.params },
          liveParams: {},
          specs: inputEffect.params,
          modulations: input.modulations,
          genState: null,
          modifiers: input.modifiers,
          modState: undefined,
          opacity: input.opacity,
          originNodeId: input.originNodeId,
        };
      }).filter((input): input is voice.MixInput => input !== null),
      modifiers: a.modifiers,
      modState: undefined,
      modulations: a.modulations,
      mixBlendMode: a.mixBlendMode,
      params: { ...a.params },
      attackMs: effect.attackMs,
      sustainMs: effect.sustainMs,
      releaseMs: effect.releaseMs,
      phase: 'attack',
      level: 0,
      bornAtMs: this.timeMs,
      releaseAtMs: null,
      releaseFromLevel: 1,
      via: a.via,
      deckGain: 1,
      pad: 'preview',
      originNodeId: a.originNodeId,
    };
    this.voices.push(voice);
    if (a.latchKey) this.latched.set(a.latchKey, voice.id);
    return voice;
  }

  private release(v: Voice): void {
    if (v.phase === 'release') return;
    v.phase = 'release';
    v.releaseAtMs = this.timeMs;
    v.releaseFromLevel = v.level;
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
      const actions = voice.evalChildren(this.coreEvalState(), graph, 'preview', childIds, ctx, viaPrefix, seen, draft ?? null);
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
    this.timeMs += dtMs;
    this.lastDt = dtMs;
    this.beat += (dtMs / 60000) * this.bpm;

    this.drainPendingFires();

    for (const v of this.voices) {
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
        const bus = this.bus(v.busId);
        const ramp = Math.max(60, v.mode === 'oneshot' ? v.releaseMs : (bus?.crossfadeMs ?? v.releaseMs));
        const since = this.timeMs - (v.releaseAtMs ?? this.timeMs);
        v.level = Math.max(0, v.releaseFromLevel * (1 - since / ramp));
      }
    }

    const dead = this.voices.filter((v) => v.phase === 'release' && v.level <= 0.001);
    if (dead.length) {
      const deadIds = new Set(dead.map((v) => v.id));
      this.voices = this.voices.filter((v) => !deadIds.has(v.id));
      for (const [k, id] of this.latched) if (id && deadIds.has(id)) this.latched.set(k, null);
    }
  }

  /** 0..1 progress through a voice's life — drives param envelopes. */
  voicePhase(v: Voice): number {
    const age = this.timeMs - v.bornAtMs;
    if (v.mode === 'oneshot') {
      const life = Math.max(1, v.attackMs + v.sustainMs + v.releaseMs);
      return Math.min(1, age / life);
    }
    return (age / 1500) % 1;
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
