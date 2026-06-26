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
   ============================================================================= */

import type { EffectCategory } from '@ledrums/core';

// ---- Block tree (branch 2) --------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
export type SwitchOn = 'velocity' | 'section' | 'beat' | 'value';
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

/** Named envelope shapes the editor seeds from (then reshapes into a curve). */
export type EnvKind = 'none' | 'decay' | 'rise' | 'pluck' | 'pulse' | 'custom';
export const ENV_KINDS: EnvKind[] = ['decay', 'rise', 'pluck', 'pulse'];

/** A breakpoint on an envelope curve — both axes 0..1 (t = life phase, v = level). */
export interface EnvPoint {
  t: number;
  v: number;
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

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Predefined envelope shape: life phase 0..1 → level 0..1. */
export function envShape(kind: EnvKind, p: number): number {
  switch (kind) {
    case 'decay':
      return 1 - p;
    case 'rise':
      return p;
    case 'pluck':
      return p < 0.12 ? p / 0.12 : Math.exp(-(p - 0.12) * 4);
    case 'pulse':
      return 0.5 + 0.5 * Math.sin(p * Math.PI * 2);
    default:
      return 1;
  }
}

/** Sample a preset shape into editable breakpoints. */
export function presetPoints(kind: EnvKind, n = 16): EnvPoint[] {
  if (kind === 'none' || kind === 'custom') {
    return [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
    ];
  }
  const pts: EnvPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ t, v: clampUnit(envShape(kind, t)) });
  }
  return pts;
}

export function defaultEnvelope(kind: EnvKind): Envelope {
  return { kind, amount: 1, points: presetPoints(kind) };
}

export function cloneEnvelope(e: Envelope): Envelope {
  return { kind: e.kind, amount: e.amount, points: e.points.map((p) => ({ ...p })), adsr: e.adsr ? { ...e.adsr } : undefined };
}

/** ADSR stage shape (times are fractions of the voice life 0..1). */
export interface AdsrShape {
  attack: number;
  decay: number;
  sustain: number; // level 0..1
  release: number;
  curve: number; // -1..1 segment tension
}

export function defaultAdsr(): AdsrShape {
  return { attack: 0.12, decay: 0.25, sustain: 0.5, release: 0.4, curve: 0 };
}

function easeCurve(t: number, curve: number): number {
  if (curve === 0) return t;
  const k = Math.abs(curve) * 3 + 1;
  return curve > 0 ? 1 - Math.pow(1 - t, k) : Math.pow(t, k);
}

/** Render an ADSR shape into editable breakpoints (the persisted curve). */
export function adsrToPoints(a: AdsrShape, n = 48): EnvPoint[] {
  const sus = clampUnit(a.sustain);
  const tA = Math.min(clampUnit(a.attack), 0.96);
  const tD = Math.min(tA + clampUnit(a.decay), 0.98);
  const tR = Math.max(tD, 1 - clampUnit(a.release));
  const pts: EnvPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number;
    if (t <= tA) {
      v = tA <= 0 ? 1 : easeCurve(t / tA, a.curve);
    } else if (t <= tD) {
      const f = (t - tA) / Math.max(1e-4, tD - tA);
      v = 1 + (sus - 1) * easeCurve(f, a.curve);
    } else if (t <= tR) {
      v = sus;
    } else {
      const f = (t - tR) / Math.max(1e-4, 1 - tR);
      v = sus * (1 - easeCurve(f, a.curve));
    }
    pts.push({ t, v: clampUnit(v) });
  }
  return pts;
}

/** Piecewise-linear sample of an envelope's curve at life phase 0..1. */
export function sampleEnvelope(env: Envelope, phase: number): number {
  const pts = env.points;
  if (pts.length === 0) return 1;
  const t = clampUnit(phase);
  if (t <= pts[0]!.t) return pts[0]!.v;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const f = span <= 0 ? 0 : (t - a.t) / span;
      return a.v + (b.v - a.v) * f;
    }
  }
  return pts[pts.length - 1]!.v;
}

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

export function blockChildren(b: Block): Block[] {
  switch (b.kind) {
    case 'all':
    case 'random':
    case 'sequence':
    case 'switch':
      return b.children;
    case 'chance':
    case 'toggle':
      return [b.child];
    default:
      return [];
  }
}

// ---- Trigger graph (freeform node wiring) -----------------------------------

export type NodeKind = 'trigger' | BlockKind;

/** A node in the freeform trigger graph. Carries every kind's fields (only the
    ones for its `kind` are meaningful) so the editor + dialogs need no narrowing. */
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

/** Block kinds a user can add as graph nodes (the trigger input is implicit). */
export const NODE_KINDS: BlockKind[] = ['play', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle'];

/** 'play' is a sink (no children); 'trigger' is a source (no parent). */
export const nodeHasOutput = (kind: NodeKind): boolean => kind !== 'play';
export const nodeHasInput = (kind: NodeKind): boolean => kind !== 'trigger';

function cloneEnvMap(env: EnvMap): EnvMap {
  const out: EnvMap = {};
  for (const k of Object.keys(env)) out[k] = cloneEnvelope(env[k]!);
  return out;
}

/** A node with default field values; override per kind via `over`. */
export function makeNode(kind: NodeKind, id: string, x = 0, y = 0, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x,
    y,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: true,
    on: 'velocity',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    ...over,
  };
}

/** Resolve which band a 0..1 value lands in against ascending cutoffs. N cutoffs →
    N+1 bands: value ≤ cutoffs[0] → 0; ≤ cutoffs[1] → 1; …; value above the last
    cutoff → the final band (index = cutoffs.length). Empty cutoffs → band 0. */
export function bandIndex(value: number, cutoffs: readonly number[]): number {
  for (let i = 0; i < cutoffs.length; i++) {
    if (value <= cutoffs[i]!) return i;
  }
  return cutoffs.length;
}

function nodeFromBlock(b: Block): GraphNode {
  switch (b.kind) {
    case 'play':
      return makeNode('play', b.id, 0, 0, {
        mode: b.mode,
        scope: b.scope,
        effectId: b.effectId,
        presetId: b.presetId,
        params: { ...b.params },
        env: cloneEnvMap(b.env),
        linked: b.linked,
      });
    case 'random':
      return makeNode('random', b.id, 0, 0, { noRepeat: b.noRepeat });
    case 'switch':
      return makeNode('switch', b.id, 0, 0, { on: b.on });
    case 'chance':
      return makeNode('chance', b.id, 0, 0, { p: b.p });
    default:
      return makeNode(b.kind, b.id);
  }
}

export const NODE_W = 220;
const H_GAP = 90;
const ROW_H = 140;

/** Convert an authored Block tree into a positioned graph (trigger + nodes + edges). */
export function treeToGraph(tree: Block): TriggerGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let row = 0;
  let edgeSeq = 0;
  const link = (from: string, to: string): void => {
    edges.push({ id: `e${edgeSeq++}`, from, to });
  };

  const walk = (b: Block, depth: number): { id: string; y: number } => {
    const node = nodeFromBlock(b);
    node.x = depth * (NODE_W + H_GAP);
    nodes.push(node);
    const kids = blockChildren(b);
    if (kids.length === 0) {
      node.y = row++ * ROW_H;
    } else {
      const infos = kids.map((k) => {
        const ci = walk(k, depth + 1);
        link(node.id, ci.id);
        return ci;
      });
      node.y = (infos[0]!.y + infos[infos.length - 1]!.y) / 2;
    }
    return { id: node.id, y: node.y };
  };

  const root = walk(tree, 1);
  const trigger = makeNode('trigger', 'trigger', 0, root.y);
  nodes.push(trigger);
  link(trigger.id, root.id);
  return { nodes, edges };
}

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
        if (node.on === 'value') return this.evalValueSwitch(graph, node, ctx, label, seen2);
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
  private switchIndexN(n: number, on: SwitchOn, ctx: TriggerCtx): number {
    let frac = 0;
    if (on === 'velocity') frac = ctx.velocity;
    else if (on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
    else if (on === 'beat') frac = ctx.beatPhase;
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
    let frac = 0;
    if (block.on === 'velocity') frac = ctx.velocity;
    else if (block.on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
    else if (block.on === 'beat') frac = ctx.beatPhase;
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
