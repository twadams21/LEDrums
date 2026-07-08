/**
 * Graph eval — the pure trigger-graph → actions transform (ported from
 * `sim.evalGraph`/`evalNode`). Given a {@link TriggerGraph}, a per-slot/pad state
 * prefix, a {@link TriggerCtx}, and the engine's mutable eval state ({@link EvalState}),
 * it walks the graph deterministically and emits a flat list of {@link Action}s for the
 * voice pool to apply. No IO, no wall-clock, no `Math.random` — all randomness is the
 * seeded {@link Prng} carried in {@link EvalState}; sequence/random/toggle state lives in
 * the maps the engine owns, so eval adds no hidden global state.
 */
import type { Prng } from './prng';
import type {
  GraphNode,
  GraphEdge,
  ParamValues,
  PlayMode,
  PlayType,
  Preset,
  ResolvedModifier,
  Scope,
  SwitchOn,
  TriggerGraph,
} from './types';
import type { Mapping } from './modulation';
import { quantizeSteppedRandom, sampleRandomDistribution } from './modulation';
import { computeDelayMs } from './delay';
import { resolveModifierChain, resolveModifierNode } from './modifier-graph';
import { resolveNodeModulations } from './modulation-graph';
import { compileRenderPlan, type RenderPlan, type RenderPlanChild } from './render-plan';
import { intersectScopeTargets } from './scope';
import type { BlendMode } from '../color/blend';

// ---- Eval actions (engine-internal) -----------------------------------------

export interface PlayAction {
  kind: 'play';
  effectId: string;
  /** The play node's type (D3) — carried verbatim to the spawned voice. Taxonomy only;
      nothing on the action/voice render path branches on it. */
  playType?: PlayType;
  /** Canvas-scene doc id (playType 'canvas') — the pool hosts it as a `canvas:<sceneId>`
      generator id, so the compositor/bridge dispatch stays untouched. */
  canvasScene?: string;
  mode: PlayMode;
  scope: Scope;
  /** Per-play-node scope target (see {@link GraphNode.targetId}). Carried verbatim
      from the graph node to the voice pool so the compositor can resolve the pixel range. */
  targetId?: string;
  /** layer/bus override ('' → the effect's default bus). */
  busId: string;
  params: ParamValues;
  /**
   * Resolved modifier chain for this play node's `mod` input (S28 seam). Carried verbatim to
   * the spawned voice. Populated by graph resolution in S29 (walk `mod` edges, order by
   * topology / y-position, flatten); `undefined` until then, so S28 voices are unmodified.
   */
  modifiers?: ResolvedModifier[];
  /**
   * Resolved modulation mappings onto this play node's effect params (doc 10). Carried
   * verbatim to the spawned voice. Populated by graph resolution in S34 (walk `param:<key>`
   * modulation edges); `undefined` until then, so S33 voices carry no mappings unless a test
   * injects them at the compositor seam.
   */
  modulations?: Mapping[];
  mixBlendMode?: BlendMode;
  mixInputs?: MixInputDraft[];
  via: string;
  latchKey: string | null;
}
export interface StopAction {
  kind: 'stop';
  voiceId: string;
  via: string;
}

/**
 * A deferred child-eval descriptor emitted by a delay node. The engine converts it to a
 * `PendingFire` (adding an absolute `fireAtMs = timeMs + relativeDelayMs`) and drains it
 * inside `tick()`. Carries everything needed to reproduce an immediate fire
 * deterministically: the graph + pad state prefix (so PRNG/sequence/toggle buckets match),
 * the ctx snapshot (velocity/bpm/section/beat at enqueue time), and the cycle guard.
 * Structurally exported so the engine and the web-mirror slice can share the same drain
 * flow; the engine's `PendingFire` adds `fireAtMs` + `enqueueOrder`.
 */
export interface PendingDescriptor {
  /** Relative delay from the current engine time at enqueue. The engine adds its `timeMs`
      to produce the absolute `fireAtMs`. Snapshot-stable — later bpm changes do NOT alter
      it because the value was resolved at enqueue time. */
  relativeDelayMs: number;
  graph: TriggerGraph;
  /** State-prefix key (`${graphKey}#${slotIndex}` or bare padKey). */
  pad: string;
  /** Full trigger context snapshotted at enqueue time (velocity + bpm + section + beat). */
  ctx: TriggerCtx;
  /** Node ids of the delay node's wired children to evaluate when the fire comes due. */
  childIds: string[];
  /** Label prefix for the via-chain (e.g. `'Delay 250ms'`). */
  viaPrefix: string;
  /** Cycle guard: the seen-set at enqueue time — includes the delay node's own id so a
      self-referencing delay cannot loop forever. */
  seen: Set<string>;
  draft?: PlayDraft | null;
}

export interface PendingAction {
  kind: 'pending';
  descriptor: PendingDescriptor;
}

export type Action = PlayAction | StopAction | PendingAction;
type PlayDraft = Omit<PlayAction, 'kind' | 'via' | 'latchKey'> & { originNodeId?: string };
type MixInputDraft = PlayDraft & { opacity: number; originNodeId: string };

export interface TriggerCtx {
  velocity: number;
  sectionIndex: number;
  sectionCount: number;
  beatPhase: number;
  sourceDrumId: string;
  /** Transport BPM at the moment the trigger fired — used by delay nodes to resolve
      musical divisions into milliseconds. Snapshotted at enqueue time; later bpm changes
      must NOT affect already-enqueued fires (the resolved `relativeDelayMs` is stored). */
  bpm: number;
}

/**
 * The engine-owned mutable state graph eval reads/writes. Per-node sequence/random/
 * latch buckets are keyed by `${statePrefix}#${nodeId}` (the prefix being a per-slot or
 * pad key) so layers/pads don't collide. References are held, not copied — eval mutates
 * the engine's own maps in place, preserving the original `this.*` semantics exactly.
 */
export interface EvalState {
  seqIndex: Map<string, number>;
  lastPick: Map<string, number>;
  latched: Map<string, string | null>;
  prng: Prng;
  presetsById: Map<string, Preset>;
  isVoiceAlive(id: string): boolean;
}

/** Entry point: eval a graph from its trigger node into a flat action list. */
export function evalGraph(state: EvalState, graph: TriggerGraph, pad: string, ctx: TriggerCtx): Action[] {
  if (graph.version === 3) return evalGraphGen3(state, graph, pad, ctx);
  const trig = graph.nodes.find((n) => n.kind === 'trigger');
  if (!trig) return [];
  return evalNode(state, graph, pad, trig, ctx, '', new Set());
}

/** A node's wired children, ordered top→bottom (visual y) for determinism. */
function childrenOf(graph: TriggerGraph, node: GraphNode): GraphNode[] {
  return graph.edges
    .filter((e) => e.from === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => a.y - b.y);
}

/** Children wired from a specific source handle (value+bands switch). Mirrors
    {@link childrenOf} but filters by `fromPort`, still y-sorted for determinism. */
function childrenViaPort(graph: TriggerGraph, node: GraphNode, port: string): GraphNode[] {
  return graph.edges
    .filter((e) => e.from === node.id && e.fromPort === port)
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => a.y - b.y);
}

function nodeStateKey(pad: string, nodeId: string): string {
  return `${pad}#${nodeId}`;
}

function evalNode(
  state: EvalState,
  graph: TriggerGraph,
  pad: string,
  node: GraphNode,
  ctx: TriggerCtx,
  viaPrefix: string,
  seen: Set<string>,
): Action[] {
  return evalNodeWithDraft(state, graph, pad, node, ctx, viaPrefix, seen, null);
}

function freezeRandomMappings(mappings: Mapping[] | undefined, prng: Prng): Mapping[] | undefined {
  if (!mappings?.length) return mappings;
  let changed = false;
  const out = mappings.map((m) => {
    if (m.source.kind !== 'random') return m;
    changed = true;
    const raw = sampleRandomDistribution(m.source.distribution, prng);
    const value = m.source.distribution === 'stepped' ? quantizeSteppedRandom(raw, m.source.steps) : raw;
    return { ...m, source: { ...m.source, value } };
  });
  return changed ? out : mappings;
}

function incomingFlowEdges(graph: TriggerGraph, node: GraphNode) {
  return graph.edges
    .filter((e) => e.to === node.id && (e.toPort == null || e.toPort === 'in'))
    .sort((a, b) => {
      const ay = graph.nodes.find((n) => n.id === a.from)?.y ?? 0;
      const by = graph.nodes.find((n) => n.id === b.from)?.y ?? 0;
      return ay - by || a.id.localeCompare(b.id);
    });
}

function edgeOpacity(value: number | undefined): number {
  return value == null ? 1 : value < 0 ? 0 : value > 1 ? 1 : value;
}

function planFlowChildren(plan: RenderPlan, node: GraphNode): RenderPlanChild[] {
  return plan.flowChildrenById.get(node.id) ?? [];
}

type RouteDraft = { kind: 'empty' } | { kind: 'play'; play: PlayDraft };
interface BucketEntry {
  draft: RouteDraft;
  edge?: GraphEdge;
  latchKey?: string | null;
}

const EMPTY_ROUTE: RouteDraft = { kind: 'empty' };

function routePlay(draft: RouteDraft): PlayDraft | null {
  return draft.kind === 'play' ? draft.play : null;
}

function makePlayDraft(state: EvalState, graph: TriggerGraph, node: GraphNode): PlayDraft | null {
  if (!node.effectId) return null;
  const mods = resolveModifierChain(graph, node);
  const modulations = resolveNodeModulations(graph, node);
  return {
    effectId: node.effectId,
    playType: node.playType,
    canvasScene: node.canvasScene,
    mode: node.mode,
    scope: node.scope,
    targetId: node.targetId,
    busId: node.busId,
    params: node.params,
    modifiers: mods.length ? mods : undefined,
    modulations: freezeRandomMappings(modulations.length ? modulations : undefined, state.prng),
    originNodeId: node.id,
  };
}

function appendLabel(prefix: string, part: string): string {
  return prefix ? `${prefix} → ${part}` : part;
}

function evalGraphGen3(state: EvalState, graph: TriggerGraph, pad: string, ctx: TriggerCtx): Action[] {
  const plan = compileRenderPlan(graph);
  if (plan.fatal || !plan.triggerId) return [];
  return evalGraphGen3FromPlan(state, plan, pad, [plan.triggerId], ctx, '', new Set(), null);
}

function evalGraphGen3From(
  state: EvalState,
  graph: TriggerGraph,
  pad: string,
  startIds: readonly string[],
  ctx: TriggerCtx,
  viaPrefix: string,
  seen: Set<string>,
  initialDraft: PlayDraft | null,
): Action[] {
  const plan = compileRenderPlan(graph);
  if (plan.fatal) return [];
  return evalGraphGen3FromPlan(state, plan, pad, startIds, ctx, viaPrefix, seen, initialDraft);
}

function evalGraphGen3FromPlan(
  state: EvalState,
  plan: RenderPlan,
  pad: string,
  startIds: readonly string[],
  ctx: TriggerCtx,
  viaPrefix: string,
  seen: Set<string>,
  initialDraft: PlayDraft | null,
): Action[] {
  const graph = plan.graph;
  const byId = plan.nodesById;
  const buckets = new Map<string, BucketEntry[]>();
  const via = new Map<string, string>();
  const actions: Action[] = [];
  const queued = new Set<string>();
  const processedCount = new Map<string, number>();
  const pendingMixes = new Set<string>();
  const pendingOutputs = new Set<string>();
  const queue: string[] = [];
  const reachability = new Map<string, boolean>();

  const enqueue = (id: string): void => {
    if (!byId.has(id) || queued.has(id) || seen.has(id)) return;
    const entries = buckets.get(id) ?? [];
    if (entries.length <= (processedCount.get(id) ?? 0)) return;
    queued.add(id);
    queue.push(id);
  };
  for (const id of startIds) {
    const node = byId.get(id);
    if (!node || seen.has(id)) continue;
    buckets.set(id, [{ draft: initialDraft ? { kind: 'play', play: initialDraft } : EMPTY_ROUTE }]);
    via.set(id, viaPrefix);
    enqueue(id);
  }
  const push = (from: GraphNode, edge: GraphEdge, draft: RouteDraft, latchKey: string | null = null): void => {
    const node = byId.get(edge.to);
    if (!node) return;
    const list = buckets.get(node.id) ?? [];
    list.push({ draft, edge, latchKey });
    buckets.set(node.id, list);
    enqueue(node.id);
  };
  const pushKids = (node: GraphNode, draft: RouteDraft, latchKey: string | null = null): void => {
    for (const { edge } of planFlowChildren(plan, node)) push(node, edge, draft, latchKey);
  };
  const labelFor = (node: GraphNode, part: string): string => {
    const next = appendLabel(via.get(node.id) ?? '', part);
    return next;
  };
  const canReach = (fromId: string, toId: string, seenIds = new Set<string>()): boolean => {
    const key = `${fromId}->${toId}`;
    const cached = reachability.get(key);
    if (cached != null) return cached;
    if (fromId === toId) {
      reachability.set(key, true);
      return true;
    }
    if (seenIds.has(fromId)) {
      reachability.set(key, false);
      return false;
    }
    const from = byId.get(fromId);
    if (!from) {
      reachability.set(key, false);
      return false;
    }
    const seenNext = new Set(seenIds).add(fromId);
    const result = planFlowChildren(plan, from).some((child) => canReach(child.node.id, toId, seenNext));
    reachability.set(key, result);
    return result;
  };
  const hasPendingUpstreamMix = (nodeId: string): boolean => [...pendingMixes].some((mixId) => canReach(mixId, nodeId));

  while (queue.length || pendingMixes.size || pendingOutputs.size) {
    const pendingIds = pendingMixes.size ? pendingMixes : pendingOutputs;
    const id = queue.length
      ? queue.shift()!
      : [...pendingIds].sort((a, b) => {
          const ay = byId.get(a)?.y ?? 0;
          const by = byId.get(b)?.y ?? 0;
          return ay - by || a.localeCompare(b);
        })[0]!;
    queued.delete(id);
    pendingMixes.delete(id);
    pendingOutputs.delete(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.kind === 'mix') {
      if (queue.length || hasPendingUpstreamMix(id)) {
        pendingMixes.add(id);
        continue;
      }
    } else if (node.kind === 'output') {
      if (queue.length || pendingMixes.size) {
        pendingOutputs.add(id);
        continue;
      }
    }
    const entries = buckets.get(id) ?? [];
    const cursor = processedCount.get(id) ?? 0;
    const newEntries = entries.slice(cursor);
    if (!newEntries.length) continue;
    processedCount.set(id, entries.length);
    const sk = nodeStateKey(pad, node.id);
    switch (node.kind) {
      case 'trigger':
        pushKids(node, EMPTY_ROUTE);
        break;
      case 'effect':
      case 'play': {
        const draft = makePlayDraft(state, graph, node);
        if (!draft) break;
        via.set(node.id, labelFor(node, modeWord(node.mode)));
        const sourceEntries = newEntries.length ? newEntries : [{ draft: EMPTY_ROUTE, latchKey: null }];
        for (const entry of sourceEntries) pushKids(node, { kind: 'play', play: draft }, entry.latchKey ?? null);
        break;
      }
      case 'modifier':
        for (const entry of newEntries) {
          const play = routePlay(entry.draft);
          if (!play) continue;
          via.set(node.id, labelFor(node, 'Modifier'));
          pushKids(node, { kind: 'play', play: { ...play, modifiers: [...(play.modifiers ?? []), resolveModifierNode(graph, node)] } }, entry.latchKey ?? null);
        }
        break;
      case 'scope':
        for (const entry of newEntries) {
          const play = routePlay(entry.draft);
          if (!play) continue;
          const scoped = intersectScopeTargets(play, node, ctx.sourceDrumId);
          if (!scoped) continue;
          via.set(node.id, labelFor(node, 'Scope'));
          pushKids(node, { kind: 'play', play: { ...play, ...scoped } }, entry.latchKey ?? null);
        }
        break;
      case 'mix': {
        const inputs = entries
          .map((entry): MixInputDraft | null => {
            const play = routePlay(entry.draft);
            return play?.originNodeId ? { ...play, opacity: edgeOpacity(entry.edge?.opacity), originNodeId: play.originNodeId } : null;
          })
          .filter((input): input is MixInputDraft => !!input)
          .sort((a, b) => {
            const ay = byId.get(a.originNodeId)?.y ?? 0;
            const by = byId.get(b.originNodeId)?.y ?? 0;
            return ay - by || a.originNodeId.localeCompare(b.originNodeId);
          });
        if (!inputs.length) break;
        const host = inputs[0]!;
        const mixed: PlayDraft = {
          ...host,
          scope: 'kit',
          targetId: undefined,
          params: {},
          modifiers: undefined,
          modulations: undefined,
          mixBlendMode: node.mixBlendMode ?? 'normal',
          mixInputs: inputs,
          originNodeId: node.id,
        };
        via.set(node.id, labelFor(node, 'Mix'));
        pushKids(node, { kind: 'play', play: mixed }, entries.find((entry) => entry.latchKey)?.latchKey ?? null);
        break;
      }
      case 'output':
        for (const entry of newEntries) {
          const play = routePlay(entry.draft);
          if (!play) continue;
          const out =
            node.scope !== 'kit' || node.targetId ? intersectScopeTargets(play, node, ctx.sourceDrumId) : { scope: play.scope, targetId: play.targetId };
          if (!out) continue;
          actions.push({ kind: 'play', ...play, ...out, via: labelFor(node, 'Output'), latchKey: entry.latchKey ?? null });
        }
        break;
      case 'all':
        for (const entry of newEntries) pushKids(node, entry.draft, entry.latchKey ?? null);
        break;
      case 'random': {
        const kids = planFlowChildren(plan, node);
        if (!kids.length) break;
        let i = state.prng.nextInt(kids.length);
        if (node.noRepeat && kids.length > 1) {
          const prev = state.lastPick.get(sk);
          while (i === prev) i = state.prng.nextInt(kids.length);
        }
        state.lastPick.set(sk, i);
        for (const entry of newEntries) push(node, kids[i]!.edge, entry.draft, entry.latchKey ?? null);
        break;
      }
      case 'sequence': {
        const kids = planFlowChildren(plan, node);
        if (!kids.length) break;
        const i = (state.seqIndex.get(sk) ?? 0) % kids.length;
        state.seqIndex.set(sk, i + 1);
        for (const entry of newEntries) push(node, kids[i]!.edge, entry.draft, entry.latchKey ?? null);
        break;
      }
      case 'switch': {
        let kids: RenderPlanChild[];
        if (node.on !== 'section' && node.on !== 'beat') {
          if ((node.valueMode ?? 'gate') === 'gate') {
            const threshold = node.threshold ?? 0.5;
            const invert = node.invert ?? false;
            kids = (invert ? ctx.velocity > threshold : ctx.velocity <= threshold) ? planFlowChildren(plan, node) : [];
          } else {
            kids = planFlowChildren(plan, node).filter((x) => x.edge.fromPort === `band-${bandIndex(ctx.velocity, node.bands ?? [0.5])}`);
          }
        } else {
          kids = planFlowChildren(plan, node).filter((_, i, arr) => i === switchIndexN(arr.length, node.on, ctx));
        }
        for (const entry of newEntries) for (const kid of kids) push(node, kid.edge, entry.draft, entry.latchKey ?? null);
        break;
      }
      case 'chance':
        if (state.prng.next() <= node.p) for (const entry of newEntries) pushKids(node, entry.draft, entry.latchKey ?? null);
        break;
      case 'toggle': {
        const current = state.latched.get(sk);
        const alive = current ? state.isVoiceAlive(current) : false;
        if (alive && current) {
          state.latched.set(sk, null);
          actions.push({ kind: 'stop', voiceId: current, via: labelFor(node, 'Toggle off') });
        } else {
          for (const entry of newEntries) pushKids(node, entry.draft, sk);
        }
        break;
      }
      case 'delay': {
        const delayMs = computeDelayMs(node.delayMode ?? 'time', node.ms ?? 0, node.division ?? '1/8', ctx.bpm);
        const kids = planFlowChildren(plan, node);
        for (const entry of newEntries) {
          const draft = routePlay(entry.draft);
          if (delayMs <= 0) {
            for (const kid of kids) push(node, kid.edge, entry.draft, entry.latchKey ?? null);
          } else {
            actions.push({
              kind: 'pending',
              descriptor: {
                relativeDelayMs: delayMs,
                graph,
                pad,
                ctx,
                childIds: kids.map((kid) => kid.node.id),
                viaPrefix: labelFor(node, `Delay ${Math.round(delayMs)}ms`),
                seen: new Set(seen).add(node.id),
                draft,
              },
            });
          }
        }
        break;
      }
      case 'randomMod':
      case 'envelope':
      case 'lfo':
      case 'cc':
      case 'note':
      case 'osc':
        break;
    }
  }
  return actions;
}

function draftFromUpstream(
  graph: TriggerGraph,
  source: GraphNode,
  sourceDrumId: string,
  prng: Prng,
  seen = new Set<string>(),
): PlayDraft | null {
  if (seen.has(source.id)) return null;
  const seen2 = new Set(seen).add(source.id);
  let draft: PlayDraft | null = null;
  if (source.kind === 'play' || source.kind === 'effect') {
    if (!source.effectId) return null;
    const mods = resolveModifierChain(graph, source);
    const modulations = resolveNodeModulations(graph, source);
    draft = {
      effectId: source.effectId,
      playType: source.playType,
      canvasScene: source.canvasScene,
      mode: source.mode,
      scope: source.scope,
      targetId: source.targetId,
      busId: source.busId,
      params: source.params,
      modifiers: mods.length ? mods : undefined,
      modulations: freezeRandomMappings(modulations.length ? modulations : undefined, prng),
      originNodeId: source.id,
    };
  } else {
    const upstream = incomingFlowEdges(graph, source)
      .map((e) => graph.nodes.find((n) => n.id === e.from))
      .filter((n): n is GraphNode => !!n);
    if (upstream.length !== 1) return null;
    draft = draftFromUpstream(graph, upstream[0]!, sourceDrumId, prng, seen2);
    if (!draft) return null;
    if (source.kind === 'modifier') {
      draft = { ...draft, modifiers: [...(draft.modifiers ?? []), resolveModifierNode(graph, source)] };
    } else if (source.kind === 'scope') {
      const scoped = intersectScopeTargets(draft, source, sourceDrumId);
      if (!scoped) return null;
      draft = { ...draft, ...scoped };
    } else {
      return null;
    }
  }
  return draft;
}

function mixInputsFor(state: EvalState, graph: TriggerGraph, node: GraphNode, ctx: TriggerCtx): MixInputDraft[] {
  return incomingFlowEdges(graph, node)
    .map((edge): MixInputDraft | null => {
      const source = graph.nodes.find((n) => n.id === edge.from);
      if (!source) return null;
      const draft = draftFromUpstream(graph, source, ctx.sourceDrumId, state.prng);
      return draft?.originNodeId ? { ...draft, opacity: edgeOpacity(edge.opacity), originNodeId: draft.originNodeId } : null;
    })
    .filter((d): d is MixInputDraft => !!d);
}

function evalNodeWithDraft(
  state: EvalState,
  graph: TriggerGraph,
  pad: string,
  node: GraphNode,
  ctx: TriggerCtx,
  viaPrefix: string,
  seen: Set<string>,
  draft: PlayDraft | null,
): Action[] {
  if (seen.has(node.id)) return []; // cycle guard
  const seen2 = new Set(seen).add(node.id);
  const label = (s: string): string => (viaPrefix ? `${viaPrefix} → ${s}` : s);
  const kids = childrenOf(graph, node);
  const sk = nodeStateKey(pad, node.id);
  switch (node.kind) {
    case 'trigger':
      return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, viaPrefix, seen2, draft));
    case 'play':
    case 'effect': {
      if (!node.effectId) return [];
      // Resolve this play node's `mod` input into a flat modifier chain (S29). Empty →
      // undefined so the spawned voice keeps the zero-alloc, unmodified hot path.
      const mods = resolveModifierChain(graph, node);
      // Resolve incoming `param:<key>` modulation edges into mappings (S34). Effect specs
      // aren't available here, so ranges come from the edge (the store bakes spec min/max at
      // wire time); the render sweep filters non-number params against the live voice specs.
      const modulations = resolveNodeModulations(graph, node);
      const next: PlayDraft = {
        effectId: node.effectId,
        playType: node.playType,
        canvasScene: node.canvasScene,
        mode: node.mode,
        scope: node.scope,
        targetId: node.targetId,
        busId: node.busId,
        params: node.params,
        modifiers: mods.length ? mods : undefined,
        modulations: freezeRandomMappings(modulations.length ? modulations : undefined, state.prng),
        originNodeId: node.id,
      };
      if (kids.length > 0) {
        return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label(modeWord(node.mode)), seen2, next));
      }
      if (graph.version === 3) return [];
      return [{ kind: 'play', ...next, via: label(modeWord(node.mode)), latchKey: null }];
    }
    case 'modifier': {
      if (!draft) return [];
      const next: PlayDraft = {
        ...draft,
        modifiers: [...(draft.modifiers ?? []), resolveModifierNode(graph, node)],
      };
      return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label('Modifier'), seen2, next));
    }
    case 'mix': {
      const mixInputs = mixInputsFor(state, graph, node, ctx);
      if (mixInputs.length === 0) return [];
      const first = mixInputs[0]!;
      if (draft && draft.originNodeId !== first.originNodeId) return [];
      const next: PlayDraft = {
        ...first,
        effectId: first.effectId,
        mixBlendMode: node.mixBlendMode ?? 'normal',
        mixInputs,
      };
      return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label('Mix'), seen2, next));
    }
    case 'scope': {
      if (!draft) return [];
      const scoped = intersectScopeTargets(draft, node, ctx.sourceDrumId);
      if (!scoped) return [];
      const next: PlayDraft = { ...draft, ...scoped };
      return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label('Scope'), seen2, next));
    }
    case 'output':
      if (!draft) return [];
      if (node.scope !== 'kit' || node.targetId) {
        const scoped = intersectScopeTargets(draft, node, ctx.sourceDrumId);
        if (!scoped) return [];
        return [{ kind: 'play', ...draft, ...scoped, via: label('Output'), latchKey: null }];
      }
      return [
        {
          kind: 'play',
          ...draft,
          via: label('Output'),
          latchKey: null,
        },
      ];
    case 'randomMod':
    case 'envelope':
    case 'lfo': // S36 — modulation source, inert in flow (reaches voices via param:<key>)
    case 'cc': // S37: a CC source is inert in trigger-flow eval (reaches voices via `param:<key>`)
    case 'note':
    case 'osc':
      // Inert in trigger-flow eval: neither a modifier node nor a modulation-source node fires
      // children. A modifier reaches a voice via a play node's resolved `mod` chain; an envelope
      // via a target's resolved `param:<key>` modulations — never through the fire flow here.
      return [];
    case 'all':
      return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label('All'), seen2, draft));
    case 'random': {
      if (kids.length === 0) return [];
      let i = state.prng.nextInt(kids.length);
      if (node.noRepeat && kids.length > 1) {
        const prev = state.lastPick.get(sk);
        while (i === prev) i = state.prng.nextInt(kids.length);
      }
      state.lastPick.set(sk, i);
      return evalNodeWithDraft(state, graph, pad, kids[i]!, ctx, label(`Random[${i + 1}/${kids.length}]`), seen2, draft);
    }
    case 'sequence': {
      if (kids.length === 0) return [];
      const i = (state.seqIndex.get(sk) ?? 0) % kids.length;
      state.seqIndex.set(sk, i + 1);
      return evalNodeWithDraft(state, graph, pad, kids[i]!, ctx, label(`Seq[${i + 1}/${kids.length}]`), seen2, draft);
    }
    case 'switch': {
      // `value` (gate/bands) is canonical. `velocity` was folded into `value` and dropped
      // from SwitchOn — web migrates persisted graphs on hydrate, but core must never throw
      // or mis-route on a stray legacy `velocity` (un-migrated in-flight data), so anything
      // that isn't an explicit count-based mode (`section`/`beat`) routes through value eval.
      if (node.on !== 'section' && node.on !== 'beat') {
        return evalValueSwitch(state, graph, pad, node, ctx, label, seen2, draft);
      }
      if (kids.length === 0) return [];
      const i = switchIndexN(kids.length, node.on, ctx);
      return evalNodeWithDraft(state, graph, pad, kids[i]!, ctx, label(`Switch:${node.on}[${i + 1}]`), seen2, draft);
    }
    case 'chance': {
      if (state.prng.next() > node.p) return [];
      return kids.flatMap((c) =>
        evalNodeWithDraft(state, graph, pad, c, ctx, label(`Chance ${Math.round(node.p * 100)}%`), seen2, draft),
      );
    }
    case 'toggle': {
      const current = state.latched.get(sk);
      const alive = current ? state.isVoiceAlive(current) : false;
      if (alive && current) {
        state.latched.set(sk, null);
        return [{ kind: 'stop', voiceId: current, via: label('Toggle off') }];
      }
      const actions = kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label('Toggle on'), seen2, draft));
      const firstPlay = actions.find((a): a is PlayAction => a.kind === 'play');
      if (firstPlay) firstPlay.latchKey = sk;
      return actions;
    }
    case 'delay': {
      // Compute the delay at enqueue time from the snapshotted bpm — later transport
      // changes must NOT alter the resolved fire time.
      const delayMs = computeDelayMs(
        node.delayMode ?? 'time',
        node.ms ?? 0,
        node.division ?? '1/8',
        ctx.bpm,
      );
      const delayLabel = label(`Delay ${Math.round(delayMs)}ms`);
      if (delayMs <= 0) {
        // Zero / negative → fire children immediately, no enqueue.
        return kids.flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, delayLabel, seen2, draft));
      }
      // Deferred: emit a PendingDescriptor; the engine enqueues it and drains at the right
      // tick. `seen2` (which already includes this delay node's id) becomes the cycle guard
      // for the drain path, so a self-referencing delay cannot loop.
      const descriptor: PendingDescriptor = {
        relativeDelayMs: delayMs,
        graph,
        pad,
        ctx,
        childIds: kids.map((c) => c.id),
        viaPrefix: delayLabel,
        seen: seen2,
        draft,
      };
      return [{ kind: 'pending', descriptor }];
    }
  }
}

/**
 * Evaluate an `on:'value'` switch (value source = `ctx.velocity`, normalized 0..1).
 * New value-fields are defaulted defensively so graphs persisted before value-mode
 * existed (which lack them) still evaluate. Mirrors `sim.evalValueSwitch`.
 *  - gate: pass when value ≤ threshold (or > when inverted); pass → eval the default
 *    children, else nothing.
 *  - bands: resolve which band the value lands in (ascending cutoffs) → eval the
 *    children wired from that band's handle (`band-${i}`); other bands stay silent.
 */
function evalValueSwitch(
  state: EvalState,
  graph: TriggerGraph,
  pad: string,
  node: GraphNode,
  ctx: TriggerCtx,
  label: (s: string) => string,
  seen: Set<string>,
  draft: PlayDraft | null = null,
): Action[] {
  const value = ctx.velocity;
  const mode = node.valueMode ?? 'gate';
  if (mode === 'gate') {
    const threshold = node.threshold ?? 0.5;
    const invert = node.invert ?? false;
    const pass = invert ? value > threshold : value <= threshold;
    if (!pass) return [];
    const gateVia = `Gate ${invert ? '>' : '≤'}${Math.round(threshold * 100)}%`;
    return childrenOf(graph, node).flatMap((c) => evalNodeWithDraft(state, graph, pad, c, ctx, label(gateVia), seen, draft));
  }
  const cutoffs = node.bands ?? [0.5];
  const b = bandIndex(value, cutoffs);
  const bandVia = `Band[${b + 1}/${cutoffs.length + 1}]`;
  return childrenViaPort(graph, node, `band-${b}`).flatMap((c) =>
    evalNodeWithDraft(state, graph, pad, c, ctx, label(bandVia), seen, draft),
  );
}

function modeWord(m: PlayMode): string {
  return m === 'oneshot' ? 'One-shot' : m === 'loop' ? 'Loop' : 'Hold';
}

/** Count-based child index for the `section`/`beat` switch modes (the only modes that
    reach here — `value` is handled by {@link evalValueSwitch}). */
function switchIndexN(n: number, on: SwitchOn, ctx: TriggerCtx): number {
  if (on === 'section') return ctx.sectionCount > 0 ? ctx.sectionIndex % n : 0;
  const frac = on === 'beat' ? ctx.beatPhase : 0;
  return Math.min(n - 1, Math.floor(frac * n));
}

/**
 * Evaluate a list of child nodes by id — the pending-fire drain entry point.
 * Used by the engine to re-enter the SAME eval path as an immediate trigger fire, so
 * nested delays and cycle guards behave identically. `seen` must include the parent
 * delay node's id (set at enqueue time, carried in the {@link PendingDescriptor}).
 *
 * An unknown child id (graph was mutated between enqueue and drain) is silently
 * skipped — deterministic, never throws.
 */
export function evalChildren(
  state: EvalState,
  graph: TriggerGraph,
  pad: string,
  childIds: string[],
  ctx: TriggerCtx,
  viaPrefix: string,
  seen: Set<string>,
  draft: PlayDraft | null = null,
): Action[] {
  if (graph.version === 3) return evalGraphGen3From(state, graph, pad, childIds, ctx, viaPrefix, seen, draft);
  return childIds.flatMap((id) => {
    const child = graph.nodes.find((n) => n.id === id);
    return child ? evalNodeWithDraft(state, graph, pad, child, ctx, viaPrefix, seen, draft) : [];
  });
}

/** Resolve which band a 0..1 value lands in against ascending cutoffs. N cutoffs →
    N+1 bands: value ≤ cutoffs[0] → 0; ≤ cutoffs[1] → 1; …; value above the last
    cutoff → the final band (index = cutoffs.length). Empty cutoffs → band 0.
    Mirrors `sim.bandIndex`. */
export function bandIndex(value: number, cutoffs: readonly number[]): number {
  for (let i = 0; i < cutoffs.length; i++) {
    if (value <= cutoffs[i]!) return i;
  }
  return cutoffs.length;
}
