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

// ---- Trigger source + value normalization -----------------------------------

/** What input fires a trigger graph — declared on the graph's `trigger` node. A tagged
    union: `drum` is the existing implicit padKey binding (`"drumId:zone"`) made explicit;
    `midi` (a note OR a CC) and `osc` (an address) are direct bindings for AUTHORED graphs
    that have no physical drum zone. The MIDI channel and OSC host/namespace live on the
    patch device, NOT here. Mirrored byte-for-byte in core `voice/types.ts`. */
export type TriggerSource =
  | { kind: 'drum'; drumId: string; zone: string }
  | { kind: 'midi'; note?: number; cc?: number }
  | { kind: 'osc'; address: string };

/** A raw fire from one of the three trigger sources, in that source's native units.
    Normalized to the trigger's 0..1 value by {@link normalizeTriggerValue} — the single
    value the switch `value` mode (gate/bands) routes on, identical across all sources. */
export type TriggerFire =
  | { kind: 'drum'; velocity: number } // Sensory Percussion velocity, already 0..1
  | { kind: 'midi'; value: number } //   MIDI note-on velocity OR CC value, 0..127
  | { kind: 'osc'; arg: number }; //     OSC float argument (clamped to 0..1)

/** Normalize a raw fire to the trigger's 0..1 value — the ONE seam every source feeds so
    they route through the switch `value` mode identically. Pure: drum velocity passes
    through (already 0..1), MIDI note-velocity / CC divides by 127, OSC arg is taken as-is;
    all clamped to 0..1. Not yet wired into eval/resolution (that is a later slice). */
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

/** A raw input for offline DIRECT resolution: the identity to match a trigger source
    against, plus the value in that source's native units ({@link normalizeTriggerValue}
    normalizes it). The web mirror of the engine's raw `InputEvent`. */
export type RawTriggerInput =
  | { kind: 'midi'; note?: number; cc?: number; value: number } // value 0..127
  | { kind: 'osc'; address: string; arg: number };

/** A graph's declared input source — its `trigger` node's `source`, or undefined for a
    graph authored before the source model / with none bound. Mirrors core `engine`. */
export function triggerSourceOf(graph: TriggerGraph): TriggerSource | undefined {
  return graph.nodes.find((n) => n.kind === 'trigger')?.source;
}

/** Does a trigger source match a raw MIDI/OSC fire? `drum` sources are pad-bound and
    never match a raw midi/osc fire (they fire via the padKey path). A note fire matches
    a `note` source; a CC fire matches a `cc` source. */
export function sourceMatchesFire(source: TriggerSource | undefined, fire: RawTriggerInput): boolean {
  if (!source) return false;
  if (fire.kind === 'osc') return source.kind === 'osc' && source.address === fire.address;
  if (source.kind !== 'midi') return false;
  if (fire.note !== undefined) return source.note !== undefined && source.note === fire.note;
  if (fire.cc !== undefined) return source.cc !== undefined && source.cc === fire.cc;
  return false;
}

/** Does a trigger source match a physical drum-zone hit? Only a `drum` source matches — its
    `drumId` + `zone` must equal the hit's (zone compared as a string, the padKey form). The
    pad-path counterpart to {@link sourceMatchesFire}: together they are the ONE source-match
    rule the store's section hit-resolution shares with the engine. midi/osc sources never
    match a pad hit (they fire via raw fires). */
export function sourceMatchesPad(source: TriggerSource | undefined, drumId: string, zone: string): boolean {
  return source?.kind === 'drum' && source.drumId === drumId && source.zone === zone;
}

/** Offline DIRECT resolution: the authored graphs a raw MIDI/OSC fire triggers by their
    trigger source, each with the fire's normalized 0..1 value (what eval routes on). The
    web mirror of the engine's `resolveDirectGraphs` — the zone-map precedence half is the
    store's padKey path; this is the second half. Pure (stable key order). */
export function resolveGraphsForFire(
  graphs: Record<string, TriggerGraph>,
  fire: RawTriggerInput,
): Array<{ key: string; graph: TriggerGraph; value: number }> {
  const value = normalizeTriggerValue(
    fire.kind === 'osc' ? { kind: 'osc', arg: fire.arg } : { kind: 'midi', value: fire.value },
  );
  const out: Array<{ key: string; graph: TriggerGraph; value: number }> = [];
  for (const [key, graph] of Object.entries(graphs)) {
    if (sourceMatchesFire(triggerSourceOf(graph), fire)) out.push({ key, graph, value });
  }
  return out;
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
  // trigger (only meaningful on the `trigger` node)
  /** What input fires this graph. Optional + additive: graphs persisted before the
      trigger-source model lack it — the store hydrate back-fills a `drum` source from
      the pad key for pad-bound graphs; authored graphs stay unset until bound. */
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
    on: 'value',
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
    case 'switch': {
      const over: Partial<GraphNode> = { on: b.on };
      if (b.valueMode !== undefined) over.valueMode = b.valueMode;
      if (b.bands !== undefined) over.bands = b.bands;
      return makeNode('switch', b.id, 0, 0, over);
    }
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
  const link = (from: string, to: string, fromPort?: string): void => {
    edges.push(fromPort === undefined ? { id: `e${edgeSeq++}`, from, to } : { id: `e${edgeSeq++}`, from, to, fromPort });
  };

  const walk = (b: Block, depth: number): { id: string; y: number } => {
    const node = nodeFromBlock(b);
    node.x = depth * (NODE_W + H_GAP);
    nodes.push(node);
    const kids = blockChildren(b);
    if (kids.length === 0) {
      node.y = row++ * ROW_H;
    } else {
      // A value+bands switch routes each child from its own band handle (`band-${i}`),
      // in child order — which is top→bottom (ascending y) in this layout, matching
      // both childrenViaPort's y-sort and the fold migration, so a seed graph is
      // identical to a migrated persisted one.
      const bandPorts = b.kind === 'switch' && b.on === 'value' && b.valueMode === 'bands';
      const infos = kids.map((k, i) => {
        const ci = walk(k, depth + 1);
        link(node.id, ci.id, bandPorts ? `band-${i}` : undefined);
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

// ---- velocity → value fold (migration) --------------------------------------

/** Evenly-spaced ascending cutoffs that split 0..1 into `n` equal bands: `[1/n, …, (n−1)/n]`
    (n−1 cutoffs; `n ≤ 1` → `[]`, a single band). Reproduces the old `velocity` switch's
    even-by-count split expressed as `value`+`bands`. */
function evenCutoffs(n: number): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < n; i++) cuts.push(i / n);
  return cuts;
}

/** `velocity` was dropped from {@link SwitchOn}; a stray one is read via a string compare
    (this fold is the migrator for exactly that legacy value). */
const isVelocitySwitch = (n: GraphNode): boolean => n.kind === 'switch' && (n.on as string) === 'velocity';

/** Fold every legacy `on:'velocity'` switch in a graph into the canonical `value`+`bands`
    form, behaviour-preserving:
      - `on='value'`, `valueMode='bands'`, `bands = evenCutoffs(N)` where N is the switch's
        outgoing-edge count (N even bands == the old even-by-count split), and
      - each outgoing edge re-homed onto its band handle `band-${i}`, edges sorted by target
        y ascending — the order the old velocity switch fired children in (`childrenOf`).
    Edge cases: N≤1 → one band (`band-0`); N=0 → nothing to wire. `section`/`beat` switches
    and non-switch nodes are untouched. Idempotent + immutable: returns the SAME graph
    reference when there is no velocity switch, so re-running — or a graph authored after the
    fold — is a no-op. */
export function foldVelocitySwitch(graph: TriggerGraph): TriggerGraph {
  if (!graph.nodes.some(isVelocitySwitch)) return graph;

  const yOf = new Map(graph.nodes.map((n) => [n.id, n.y] as const));
  const migrated = new Set<string>();
  const nodes = graph.nodes.map((n) => {
    if (!isVelocitySwitch(n)) return n;
    migrated.add(n.id);
    const outCount = graph.edges.reduce((c, e) => (e.from === n.id ? c + 1 : c), 0);
    return { ...n, on: 'value' as const, valueMode: 'bands' as const, bands: evenCutoffs(outCount) };
  });

  // Re-home each migrated switch's outgoing edges onto band handles, in target-y order.
  const edges = graph.edges.map((e) => ({ ...e }));
  for (const id of migrated) {
    const outs = edges.filter((e) => e.from === id).sort((a, b) => (yOf.get(a.to) ?? 0) - (yOf.get(b.to) ?? 0));
    outs.forEach((e, i) => {
      e.fromPort = `band-${i}`;
    });
  }
  return { nodes, edges };
}

/** Apply {@link foldVelocitySwitch} across a keyed map of graphs (the store's hydrate
    migration). Each unchanged graph keeps its reference (alias-stable + idempotent). */
export function foldVelocitySwitches(graphs: Record<string, TriggerGraph>): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = foldVelocitySwitch(graph);
  return out;
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
