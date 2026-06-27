/* =============================================================================
   TRIGGER LAB — throwaway simulation.  NOT the engine, NOT production.

   Decides three branches before committing the core model:
     1. Voice model  — layers-as-buses with a mono/poly polyphony rule.
     2. Block set    — a trigger behavior-tree (Wwise/FMOD-style containers).
     3. Section change — timed morph (rides the bus crossfade/voice-stealing).

   An effect (e.g. Swirl) has parameters + named presets; a placed clip is an
   INSTANCE of effect+preset, single-instance by default with an opt-in Link so
   edits sync to the shared preset. Params can be driven by envelopes over a
   voice's life. Voices are abstract "lights" (a pattern + params + envelope).
   Delete this whole directory once the branches are decided.

   STRUCTURE (S3.3 split): this core file holds the Block-tree model, the
   effect/preset/bus/voice/section types, and the `Sim` class (voice lifecycle +
   graph/tree evaluation). The cohesive sub-concerns live alongside and are
   re-exported below so the public `./sim` surface is unchanged:
     - `./sim.envelopes`         — ADSR shapes/sampling + param primitives.
     - `./sim.trigger-source`    — TriggerSource matching + value normalization.
     - `./sim.graph-compilation` — trigger-graph types, block→graph, velocity fold.
   ============================================================================= */

import type { EffectCategory } from '@ledrums/core';
import { cloneEnvelope, type EnvMap, type ParamSpec, type ParamValues } from './sim.envelopes';
import { bandIndex, type GraphNode, type TriggerGraph } from './sim.graph-compilation';

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
  defaultAdsr,
  adsrToPoints,
  sampleEnvelope,
} from './sim.envelopes';
export * from './sim.trigger-source';
export * from './sim.graph-compilation';

// ---- Block tree (branch 2) --------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
/** What a switch routes on. `value` (gate/bands) is the canonical intensity-routing
    mode; the older `velocity` mode was a near-duplicate (even count split on the same
    normalized intensity) and was folded into `value` and removed — see
    {@link foldVelocitySwitch}. `section`/`beat` are count-based and unchanged. */
export type SwitchOn = 'section' | 'beat' | 'value';
/** Sub-mode of a `value` switch: a single pass/block gate, or N value bands. */
export type ValueMode = 'gate' | 'bands';
export type Scope = 'drum' | 'kit';
export type BlockKind = Block['kind'];

/** The abstract visual an effect demonstrates in the lab's pixel renderer. */
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

export const PATTERNS: Pattern[] = ['flash', 'chase', 'sparkle', 'ripple', 'swirl', 'aurora', 'drift', 'radial', 'haze', 'strobe'];

interface BlockBase {
  id: string;
}

/** Leaf: an instance of an effect+preset (single-instance unless `linked`). */
export interface PlayBlock extends BlockBase {
  kind: 'play';
  mode: PlayMode;
  scope: Scope;
  effectId: string;
  presetId: string;
  /** instance param values (used when not linked). */
  params: ParamValues;
  /** per-param envelope assignment. */
  env: EnvMap;
  /** true → bound to the shared preset; edits sync everywhere it's used. */
  linked: boolean;
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
  pattern: Pattern;
  /**
   * When set, this effect is GENERATOR-BACKED: a voice hosting it delegates rendering
   * to the legacy core {@link EffectGenerator} registered under this id. The server
   * voice path renders it for real output; the offline preview (render.ts) delegates to
   * the SAME core generator. `pattern` is ignored for these effects.
   */
  generatorId?: string;
  /** Legacy effect category (base/trigger/wash/meter/texture/particle/utility) —
      surfaced so the gallery can group/filter generator effects. */
  category?: EffectCategory;
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
  pattern: Pattern;
  busId: string;
  mode: PlayMode;
  scope: Scope;
  sourceDrumId: string | null;
  /** hit velocity 0..1 at spawn — drives a hosted generator's synthetic trigger. */
  velocity: number;
  /** hosted legacy-generator id (offline preview delegates to the core generator), or
      null for a pattern voice. Mirrors the core Voice field. */
  generatorId?: string | null;
  /** per-voice generator state (from the core EffectGenerator's createState) — built
      lazily by the offline renderer and persisted for the voice's life. */
  genState?: unknown;
  /** resolved param snapshot at spawn. */
  params: ParamValues;
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

type PlayAction = {
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
};
type StopAction = { kind: 'stop'; voiceId: string; via: string };
type Action = PlayAction | StopAction;

export interface TriggerCtx {
  velocity: number;
  sectionIndex: number;
  sectionCount: number;
  beatPhase: number;
  sourceDrumId: string;
}

let voiceSeq = 0;

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
  log: LogEntry[] = [];

  private effectsById = new Map<string, EffectDef>();
  private presets: Preset[];
  private presetsById = new Map<string, Preset>();

  private seqIndex = new Map<string, number>();
  private lastPick = new Map<string, number>();
  private latched = new Map<string, string | null>();

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

  trigger(padLabel: string, tree: Block, ctx: TriggerCtx): string[] {
    const actions = this.evaluate(tree, ctx);
    const resolved: string[] = [];
    for (const a of actions) {
      if (a.kind === 'stop') {
        const v = this.voices.find((x) => x.id === a.voiceId);
        if (v) {
          this.release(v);
          resolved.push(`■ stop ${this.effectName(v.effectId)} (${a.via})`);
        }
      } else {
        const v = this.spawn(a, ctx.sourceDrumId, ctx.velocity);
        if (v) resolved.push(`▶ ${this.modeGlyph(a.mode)} ${this.effectName(a.effectId)} → ${this.busName(v.busId)}  (${a.via})`);
      }
    }
    if (resolved.length === 0) resolved.push('— nothing (chance/empty)');
    this.log.unshift({ t: this.timeMs, pad: padLabel, resolved });
    if (this.log.length > 60) this.log.length = 60;
    return resolved;
  }

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
      } else {
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
    const trig = graph.nodes.find((n) => n.kind === 'trigger');
    if (!trig) return [];
    return this.evalNode(graph, trig, ctx, '', new Set());
  }

  /** A node's wired children, ordered top→bottom (visual y) for determinism. */
  private childrenOf(graph: TriggerGraph, node: GraphNode): GraphNode[] {
    return graph.edges
      .filter((e) => e.from === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => a.y - b.y);
  }

  /** Children wired from a specific source handle (value+bands switch). Mirrors
      {@link childrenOf} but filters by `fromPort`, still y-sorted for determinism. */
  private childrenViaPort(graph: TriggerGraph, node: GraphNode, port: string): GraphNode[] {
    return graph.edges
      .filter((e) => e.from === node.id && e.fromPort === port)
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => a.y - b.y);
  }

  private evalNode(graph: TriggerGraph, node: GraphNode, ctx: TriggerCtx, viaPrefix: string, seen: Set<string>): Action[] {
    if (seen.has(node.id)) return []; // cycle guard
    const seen2 = new Set(seen).add(node.id);
    const label = (s: string): string => (viaPrefix ? `${viaPrefix} → ${s}` : s);
    const kids = this.childrenOf(graph, node);
    switch (node.kind) {
      case 'trigger':
        return kids.flatMap((c) => this.evalNode(graph, c, ctx, viaPrefix, seen2));
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
            via: label(this.modeWord(node.mode)),
            latchKey: null,
          },
        ];
      case 'all':
        return kids.flatMap((c) => this.evalNode(graph, c, ctx, label('All'), seen2));
      case 'random': {
        if (kids.length === 0) return [];
        let i = Math.floor(Math.random() * kids.length);
        if (node.noRepeat && kids.length > 1) {
          const prev = this.lastPick.get(node.id);
          while (i === prev) i = Math.floor(Math.random() * kids.length);
        }
        this.lastPick.set(node.id, i);
        return this.evalNode(graph, kids[i]!, ctx, label(`Random[${i + 1}/${kids.length}]`), seen2);
      }
      case 'sequence': {
        if (kids.length === 0) return [];
        const i = (this.seqIndex.get(node.id) ?? 0) % kids.length;
        this.seqIndex.set(node.id, i + 1);
        return this.evalNode(graph, kids[i]!, ctx, label(`Seq[${i + 1}/${kids.length}]`), seen2);
      }
      case 'switch': {
        // `value` (gate/bands) is canonical. `velocity` was folded into it and dropped from
        // SwitchOn — graphs are migrated on hydrate (foldVelocitySwitch), but route anything
        // that isn't a count-based mode (`section`/`beat`) through value eval so a stray
        // legacy `velocity` never throws or mis-routes (mirrors core engine).
        if (node.on !== 'section' && node.on !== 'beat') return this.evalValueSwitch(graph, node, ctx, label, seen2);
        if (kids.length === 0) return [];
        const i = this.switchIndexN(kids.length, node.on, ctx);
        return this.evalNode(graph, kids[i]!, ctx, label(`Switch:${node.on}[${i + 1}]`), seen2);
      }
      case 'chance': {
        if (Math.random() > node.p) return [];
        return kids.flatMap((c) => this.evalNode(graph, c, ctx, label(`Chance ${Math.round(node.p * 100)}%`), seen2));
      }
      case 'toggle': {
        const current = this.latched.get(node.id);
        const alive = current ? this.voices.some((v) => v.id === current) : false;
        if (alive && current) {
          this.latched.set(node.id, null);
          return [{ kind: 'stop', voiceId: current, via: label('Toggle off') }];
        }
        const actions = kids.flatMap((c) => this.evalNode(graph, c, ctx, label('Toggle on'), seen2));
        const firstPlay = actions.find((a) => a.kind === 'play') as PlayAction | undefined;
        if (firstPlay) firstPlay.latchKey = node.id;
        return actions;
      }
    }
  }

  private resolveNodeParams(node: GraphNode): ParamValues {
    if (node.linked) return this.preset(node.presetId)?.params ?? node.params;
    return node.params;
  }
  /** Count-based child index for the `section`/`beat` switch modes (the only modes that
      reach here — `value` is routed to {@link evalValueSwitch}). */
  private switchIndexN(n: number, on: SwitchOn, ctx: TriggerCtx): number {
    if (on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
    const frac = on === 'beat' ? ctx.beatPhase : 0;
    return Math.min(n - 1, Math.floor(frac * n));
  }

  /** Evaluate an on:'value' switch (value source = ctx.velocity, normalized 0..1).
      New fields are defaulted defensively so graphs persisted before value-mode
      existed (which lack them) still evaluate. */
  private evalValueSwitch(
    graph: TriggerGraph,
    node: GraphNode,
    ctx: TriggerCtx,
    label: (s: string) => string,
    seen: Set<string>,
  ): Action[] {
    const value = ctx.velocity;
    const mode = node.valueMode ?? 'gate';
    if (mode === 'gate') {
      const threshold = node.threshold ?? 0.5;
      const invert = node.invert ?? false;
      const pass = invert ? value > threshold : value <= threshold;
      if (!pass) return [];
      const gateVia = `Gate ${invert ? '>' : '≤'}${Math.round(threshold * 100)}%`;
      return this.childrenOf(graph, node).flatMap((c) => this.evalNode(graph, c, ctx, label(gateVia), seen));
    }
    const cutoffs = node.bands ?? [0.5];
    const b = bandIndex(value, cutoffs);
    const bandVia = `Band[${b + 1}/${cutoffs.length + 1}]`;
    return this.childrenViaPort(graph, node, `band-${b}`).flatMap((c) =>
      this.evalNode(graph, c, ctx, label(bandVia), seen),
    );
  }

  /** Resolve a Play block's live params (linked → shared preset, else instance). */
  private resolveParams(block: PlayBlock): ParamValues {
    if (block.linked) return this.preset(block.presetId)?.params ?? block.params;
    return block.params;
  }

  private evaluate(block: Block, ctx: TriggerCtx, viaPrefix = ''): Action[] {
    const label = (s: string) => (viaPrefix ? `${viaPrefix} → ${s}` : s);
    switch (block.kind) {
      case 'play': {
        return [
          {
            kind: 'play',
            effectId: block.effectId,
            mode: block.mode,
            scope: block.scope,
            busId: '',
            params: this.resolveParams(block),
            env: block.env,
            via: label(this.modeWord(block.mode)),
            latchKey: null,
          },
        ];
      }
      case 'all':
        return block.children.flatMap((c) => this.evaluate(c, ctx, label('All')));
      case 'random': {
        if (block.children.length === 0) return [];
        let i = Math.floor(Math.random() * block.children.length);
        if (block.noRepeat && block.children.length > 1) {
          const prev = this.lastPick.get(block.id);
          while (i === prev) i = Math.floor(Math.random() * block.children.length);
        }
        this.lastPick.set(block.id, i);
        return this.evaluate(block.children[i]!, ctx, label(`Random[${i + 1}/${block.children.length}]`));
      }
      case 'sequence': {
        if (block.children.length === 0) return [];
        const i = this.seqIndex.get(block.id) ?? 0;
        this.seqIndex.set(block.id, (i + 1) % block.children.length);
        return this.evaluate(block.children[i]!, ctx, label(`Seq[${i + 1}/${block.children.length}]`));
      }
      case 'switch': {
        if (block.children.length === 0) return [];
        const i = this.switchIndex(block, ctx);
        return this.evaluate(block.children[i]!, ctx, label(`Switch:${block.on}[${i + 1}]`));
      }
      case 'chance': {
        if (Math.random() > block.p) return [];
        return this.evaluate(block.child, ctx, label(`Chance ${Math.round(block.p * 100)}%`));
      }
      case 'toggle': {
        const current = this.latched.get(block.id);
        const alive = current ? this.voices.some((v) => v.id === current) : false;
        if (alive && current) {
          this.latched.set(block.id, null);
          return [{ kind: 'stop', voiceId: current, via: label('Toggle off') }];
        }
        const actions = this.evaluate(block.child, ctx, label('Toggle on'));
        const firstPlay = actions.find((a) => a.kind === 'play') as PlayAction | undefined;
        if (firstPlay) firstPlay.latchKey = block.id;
        return actions;
      }
    }
  }

  private switchIndex(block: SwitchBlock, ctx: TriggerCtx): number {
    const n = block.children.length;
    if (block.on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
    const frac = block.on === 'beat' ? ctx.beatPhase : 0;
    return Math.min(n - 1, Math.floor(frac * n));
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

    const voice: Voice = {
      id: `v${++voiceSeq}`,
      effectId: a.effectId,
      pattern: effect.pattern,
      busId: bus.id,
      mode: a.mode,
      scope: a.scope,
      sourceDrumId,
      velocity,
      generatorId: effect.generatorId ?? null,
      genState: null,
      params: { ...a.params },
      env: Object.fromEntries(Object.entries(a.env).map(([k, e]) => [k, cloneEnvelope(e)])),
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
  }

  // --- tick ----------------------------------------------------------------

  tick(dtMs: number): void {
    this.timeMs += dtMs;
    this.lastDt = dtMs;
    this.beat += (dtMs / 60000) * this.bpm;

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
    return { kind: 'play', effectId, mode: 'loop', scope: 'kit', busId: '', params, env: {}, via, latchKey: null };
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
  private modeWord(m: PlayMode): string {
    return m === 'oneshot' ? 'One-shot' : m === 'loop' ? 'Loop' : 'Hold';
  }
  private modeGlyph(m: PlayMode): string {
    return m === 'oneshot' ? '⚡' : m === 'loop' ? '∞' : '⊓';
  }
}
