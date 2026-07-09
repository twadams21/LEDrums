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
import { compileRenderPlan, type RenderPlan, type RenderPlanCache, type RenderPlanChild } from './render-plan';
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
  /** Origin graph node this action's layer was produced by (a play/effect node, or the
      Mix node for a composite). Carried so the engine/sim can tag the spawned voice for
      origin-keyed liveness — the signal delay-overlap Mix composition reads (R13). */
  originNodeId?: string;
  /**
   * B1 — this composite is a delayed Mix *re-composition* that supersedes the prior still-live
   * composite at the same `(pad, originNodeId)`. On a delayed drain the fold re-includes A into
   * a fresh `Mix[A,B]`, but the immediate `Mix[A]` voice keeps rendering A (poly buses never
   * steal), so A composites twice for the whole overlap window. When this flag is set the voice
   * pool releases the prior `(pad, originNodeId)` voice before spawning — the two composites are
   * one evolving timeline voice, not siblings. Set ONLY on a drained re-composition (`seen.size
   * > 0` with the overlap machinery on); immediate and `delay 0`-inline folds spawn the first
   * voice and leave it unset, so genuine multiplicity (rapid re-fires, distinct effects) is
   * untouched. See {@link VoicePool.spawn}. */
  supersedePriorVoice?: boolean;
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
export type PlayDraft = Omit<PlayAction, 'kind' | 'via' | 'latchKey'> & { originNodeId?: string };
export type MixInputDraft = PlayDraft & { opacity: number; originNodeId: string };

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
  /**
   * Persistent per-(pad, mix-node) snapshot of the Mix's contributing layer members
   * (R13 delay = timeline shift). Populated by the Mix evaluator as members arrive across
   * eval batches; a delayed branch draining into the same Mix reads it to re-compose with
   * members that started earlier. Engine-owned (like {@link seqIndex}); absent → the
   * overlap machinery is off and eval falls back to eval-batch membership.
   */
  mixMemberSnapshots?: Map<string, MixInputDraft[]>;
  /**
   * Is a layer origin node still live (its voice not yet decayed) for this pad? Read by the
   * Mix evaluator on a delayed drain to decide which snapshotted members still compose;
   * decayed members are absent. Backed by the engine/sim scanning active voices' origins.
   * Absent → no member is treated as live, so a drain stays batch-scoped.
   */
  isLayerLive?(pad: string, originNodeId: string): boolean;
  /**
   * Render-plan compile cache (R18). When present, {@link compileRenderPlan} is served through it so
   * repeated hits on an unchanged graph reuse the plan instead of recompiling per fire. Engine-owned
   * (like {@link mixMemberSnapshots}); absent → eval compiles fresh every call, so output is identical
   * with and without the cache (only the compile is skipped, never the plan's content).
   */
  renderPlanCache?: RenderPlanCache;
}

/** Compile `graph` via the injected cache when the engine supplies one, else a fresh compile.
    Determinism is unaffected — the cache only returns a plan a fresh compile would have produced. */
function compilePlan(state: EvalState, graph: TriggerGraph): RenderPlan {
  return state.renderPlanCache ? state.renderPlanCache.compile(graph) : compileRenderPlan(graph);
}

/**
 * Entry point: eval a Gen3 graph from its trigger node into a flat action list.
 *
 * The graph is always Gen3 (`version === 3`): the engine normalizes every graph to
 * Gen3 at `setShow` (see {@link normalizeTriggerGraphToGen3}) before it can reach eval,
 * so there is exactly one evaluator. Callers that hand this a raw legacy graph must
 * normalize first.
 */
export function evalGraph(state: EvalState, graph: TriggerGraph, pad: string, ctx: TriggerCtx): Action[] {
  return evalGraphGen3(state, graph, pad, ctx);
}

function nodeStateKey(pad: string, nodeId: string): string {
  return `${pad}#${nodeId}`;
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
  const plan = compilePlan(state, graph);
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
  const plan = compilePlan(state, graph);
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
  /** R14 — Effect/play node ids that have already emitted their firing in THIS eval call.
      Fan-in (multiple flow edges converging on one Effect) coalesces to a single firing per
      trigger: the play draft is a pure function of the node, so re-firing per incoming edge
      would emit identical duplicate voices (double / N× brightness). A delayed re-arrival
      drains in a SEPARATE eval call (fresh set) and stays a distinct temporal firing (R13). */
  const firedEffects = new Set<string>();
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
        // R14 — fan-in coalescing. All flow edges converging on this Effect within one trigger
        // fire produce ONE voice, not one per edge. `draft` is derived purely from the node, so
        // the incoming entries only carry the latch key; pick the first latched one (matching the
        // Mix collector). Guard by node id so later waves in the same call (e.g. an Effect fed
        // downstream of a Mix) don't re-fire either. Delayed drains are a fresh call → separate.
        if (firedEffects.has(node.id)) break;
        firedEffects.add(node.id);
        // N2 — one voice ⇒ one latch: only the first latched edge's key registers; any secondary
        // per-edge latch keys from other converging edges are intentionally dropped (mirrors the
        // Mix collector). Two distinct toggle paths into one Effect thus share a single latch.
        const latchKey = newEntries.find((entry) => entry.latchKey != null)?.latchKey ?? null;
        pushKids(node, { kind: 'play', play: draft }, latchKey);
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
          .filter((input): input is MixInputDraft => !!input);

        // R13 — delay = timeline shift. Composition membership at a Mix is temporal overlap,
        // not eval-batch membership. Record this batch's members into the persistent snapshot,
        // then (on a delayed drain) fold back the members that started in an earlier batch and
        // are still live, so the delayed layer composes with them per the Mix blend rules;
        // decayed members are absent. Render-time coalescing of the overlap is R14.
        const snapKey = nodeStateKey(pad, node.id);
        const snapshots = state.mixMemberSnapshots;
        // A drained batch (`seen.size > 0`) re-composing with folded-back members is the delay-
        // overlap re-composition B1 fixes: it supersedes the still-live immediate composite at
        // this (pad, mix-node) rather than stacking a second voice over the shared members.
        // S2 — liveness + supersession key on (pad, originNodeId) only; they cannot tell WHICH
        // trigger instance's voice is live. Under the timeline model a pad's Mix node carries a
        // single evolving composite, so a delayed drain folds/supersedes by (pad, mix-node)
        // regardless of instance. Two rapid fires on one pad therefore alias: a drain re-includes
        // (and later supersedes) whichever instance's members are still live, and the pool
        // releases the OLDEST still-live composite at that key (the most likely predecessor of
        // this evolving timeline). This is intentional and bounded — accepted as correct-enough
        // for the "one composite timeline per (pad, mix-node)" model, not a stale-params leak
        // (folds are gated on live voices; the snapshot map is engine-owned and reset on setShow).
        const isDrainRecomposition = !!snapshots && seen.size > 0;
        if (snapshots) {
          const merged = new Map((snapshots.get(snapKey) ?? []).map((m) => [m.originNodeId, m] as const));
          for (const m of inputs) merged.set(m.originNodeId, m);
          snapshots.set(snapKey, [...merged.values()]);
          if (seen.size > 0 && state.isLayerLive) {
            const inBatch = new Set(inputs.map((m) => m.originNodeId));
            for (const m of snapshots.get(snapKey) ?? []) {
              if (!inBatch.has(m.originNodeId) && state.isLayerLive(pad, m.originNodeId)) inputs.push(m);
            }
          }
        }
        inputs.sort((a, b) => {
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
        // B1 — a delayed drain re-composition supersedes the prior still-live composite at this
        // (pad, mix-node); the pool releases it instead of double-counting the shared members.
        if (isDrainRecomposition) mixed.supersedePriorVoice = true;
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

function modeWord(m: PlayMode): string {
  return m === 'oneshot' ? 'One-shot' : m === 'loop' ? 'Loop' : 'Hold';
}

/** Count-based child index for the `section`/`beat` switch modes (the only modes that
    reach here — the `value` switch is resolved inline in the Gen3 `switch` case). */
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
  return evalGraphGen3From(state, graph, pad, childIds, ctx, viaPrefix, seen, draft);
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
