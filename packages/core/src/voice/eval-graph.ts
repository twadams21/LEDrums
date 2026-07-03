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
  ParamValues,
  PlayMode,
  Preset,
  ResolvedModifier,
  Scope,
  SwitchOn,
  TriggerGraph,
} from './types';
import type { Mapping } from './modulation';
import { computeDelayMs } from './delay';
import { resolveModifierChain } from './modifier-graph';
import { resolveNodeModulations } from './modulation-graph';

// ---- Eval actions (engine-internal) -----------------------------------------

export interface PlayAction {
  kind: 'play';
  effectId: string;
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
}

export interface PendingAction {
  kind: 'pending';
  descriptor: PendingDescriptor;
}

export type Action = PlayAction | StopAction | PendingAction;

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
  if (seen.has(node.id)) return []; // cycle guard
  const seen2 = new Set(seen).add(node.id);
  const label = (s: string): string => (viaPrefix ? `${viaPrefix} → ${s}` : s);
  const kids = childrenOf(graph, node);
  const sk = nodeStateKey(pad, node.id);
  switch (node.kind) {
    case 'trigger':
      return kids.flatMap((c) => evalNode(state, graph, pad, c, ctx, viaPrefix, seen2));
    case 'play': {
      if (!node.effectId) return [];
      // Resolve this play node's `mod` input into a flat modifier chain (S29). Empty →
      // undefined so the spawned voice keeps the zero-alloc, unmodified hot path.
      const mods = resolveModifierChain(graph, node);
      // Resolve incoming `param:<key>` modulation edges into mappings (S34). Effect specs
      // aren't available here, so ranges come from the edge (the store bakes spec min/max at
      // wire time); the render sweep filters non-number params against the live voice specs.
      const modulations = resolveNodeModulations(graph, node);
      return [
        {
          kind: 'play',
          effectId: node.effectId,
          mode: node.mode,
          scope: node.scope,
          targetId: node.targetId,
          busId: node.busId,
          params: node.params,
          modifiers: mods.length ? mods : undefined,
          modulations: modulations.length ? modulations : undefined,
          via: label(modeWord(node.mode)),
          latchKey: null,
        },
      ];
    }
    case 'modifier':
    case 'envelope':
    case 'lfo': // S36 — modulation source, inert in flow (reaches voices via param:<key>)
    case 'cc': // S37: a CC source is inert in trigger-flow eval (reaches voices via `param:<key>`)
      // Inert in trigger-flow eval: neither a modifier node nor a modulation-source node fires
      // children. A modifier reaches a voice via a play node's resolved `mod` chain; an envelope
      // via a target's resolved `param:<key>` modulations — never through the fire flow here.
      return [];
    case 'all':
      return kids.flatMap((c) => evalNode(state, graph, pad, c, ctx, label('All'), seen2));
    case 'random': {
      if (kids.length === 0) return [];
      let i = state.prng.nextInt(kids.length);
      if (node.noRepeat && kids.length > 1) {
        const prev = state.lastPick.get(sk);
        while (i === prev) i = state.prng.nextInt(kids.length);
      }
      state.lastPick.set(sk, i);
      return evalNode(state, graph, pad, kids[i]!, ctx, label(`Random[${i + 1}/${kids.length}]`), seen2);
    }
    case 'sequence': {
      if (kids.length === 0) return [];
      const i = (state.seqIndex.get(sk) ?? 0) % kids.length;
      state.seqIndex.set(sk, i + 1);
      return evalNode(state, graph, pad, kids[i]!, ctx, label(`Seq[${i + 1}/${kids.length}]`), seen2);
    }
    case 'switch': {
      // `value` (gate/bands) is canonical. `velocity` was folded into `value` and dropped
      // from SwitchOn — web migrates persisted graphs on hydrate, but core must never throw
      // or mis-route on a stray legacy `velocity` (un-migrated in-flight data), so anything
      // that isn't an explicit count-based mode (`section`/`beat`) routes through value eval.
      if (node.on !== 'section' && node.on !== 'beat') {
        return evalValueSwitch(state, graph, pad, node, ctx, label, seen2);
      }
      if (kids.length === 0) return [];
      const i = switchIndexN(kids.length, node.on, ctx);
      return evalNode(state, graph, pad, kids[i]!, ctx, label(`Switch:${node.on}[${i + 1}]`), seen2);
    }
    case 'chance': {
      if (state.prng.next() > node.p) return [];
      return kids.flatMap((c) =>
        evalNode(state, graph, pad, c, ctx, label(`Chance ${Math.round(node.p * 100)}%`), seen2),
      );
    }
    case 'toggle': {
      const current = state.latched.get(sk);
      const alive = current ? state.isVoiceAlive(current) : false;
      if (alive && current) {
        state.latched.set(sk, null);
        return [{ kind: 'stop', voiceId: current, via: label('Toggle off') }];
      }
      const actions = kids.flatMap((c) => evalNode(state, graph, pad, c, ctx, label('Toggle on'), seen2));
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
        return kids.flatMap((c) => evalNode(state, graph, pad, c, ctx, delayLabel, seen2));
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
): Action[] {
  const value = ctx.velocity;
  const mode = node.valueMode ?? 'gate';
  if (mode === 'gate') {
    const threshold = node.threshold ?? 0.5;
    const invert = node.invert ?? false;
    const pass = invert ? value > threshold : value <= threshold;
    if (!pass) return [];
    const gateVia = `Gate ${invert ? '>' : '≤'}${Math.round(threshold * 100)}%`;
    return childrenOf(graph, node).flatMap((c) => evalNode(state, graph, pad, c, ctx, label(gateVia), seen));
  }
  const cutoffs = node.bands ?? [0.5];
  const b = bandIndex(value, cutoffs);
  const bandVia = `Band[${b + 1}/${cutoffs.length + 1}]`;
  return childrenViaPort(graph, node, `band-${b}`).flatMap((c) =>
    evalNode(state, graph, pad, c, ctx, label(bandVia), seen),
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
): Action[] {
  return childIds.flatMap((id) => {
    const child = graph.nodes.find((n) => n.id === id);
    return child ? evalNode(state, graph, pad, child, ctx, viaPrefix, seen) : [];
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
