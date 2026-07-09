import { describe, expect, it } from 'vitest';
import { evalChildren, evalGraph, type EvalState, type PendingAction, type PlayAction, type TriggerCtx } from './eval-graph';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

/*
 * R13 — Delay = timeline shift. The canonical `TriggerGraph → evaluated actions` seam.
 *
 * Two locked semantics (parent spec Phase 3.1, GH #92):
 *   1. `delay 0` is indistinguishable from no delay (parity).
 *   2. When a delayed branch drains into a Mix, composition membership is temporal
 *      overlap at render time, not eval-batch membership: the delayed layer composes
 *      with the Mix's still-live sibling members per the Mix blend rules; members whose
 *      voices have decayed are absent.
 *
 * Render-time coalescing of the resulting overlap (double-count, frame-exactness) is
 * R14's job, defined against this settled temporal model — not asserted here.
 */

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5, invert: false,
    bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });
const ctx = (velocity = 0.25): TriggerCtx => ({ velocity, sectionIndex: 0, sectionCount: 1, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });

/** An EvalState whose overlap machinery is wired: snapshots persist across batches and
    `isLayerLive` reports liveness for the origin ids named in `live`. */
function overlapState(live: Set<string> = new Set()): EvalState {
  return {
    seqIndex: new Map(),
    lastPick: new Map(),
    latched: new Map(),
    prng: new Prng(1),
    presetsById: new Map(),
    isVoiceAlive: () => false,
    mixMemberSnapshots: new Map(),
    isLayerLive: (_pad, originNodeId) => live.has(originNodeId),
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): TriggerGraph {
  return { version: 3, nodes: [node('trigger', 'trigger'), ...nodes, node('output', 'output')], edges };
}

const plays = (acts: ReturnType<typeof evalGraph>): PlayAction[] => acts.filter((a): a is PlayAction => a.kind === 'play');
const onlyPending = (acts: ReturnType<typeof evalGraph>): PendingAction => acts.find((a): a is PendingAction => a.kind === 'pending')!;

/** immediate A → Mix, delayed B → Mix. A at y=0, B at y=100. */
function mixGraph(ms: number, blend: 'normal' | 'add' = 'add'): TriggerGraph {
  return graph(
    [
      node('effect', 'a', { effectId: 'a', y: 0 }),
      node('delay', 'delay', { ms }),
      node('effect', 'b', { effectId: 'b', y: 100 }),
      node('mix', 'mix', { mixBlendMode: blend }),
    ],
    [
      edge('t-a', 'trigger', 'a'),
      edge('a-mix', 'a', 'mix'),
      edge('t-delay', 'trigger', 'delay'),
      edge('delay-b', 'delay', 'b'),
      edge('b-mix', 'b', 'mix'),
      edge('mix-out', 'mix', 'output'),
    ],
  );
}

/** Same topology but with NO delay node — the baseline for delay-0 parity. */
function noDelayMixGraph(blend: 'normal' | 'add' = 'add'): TriggerGraph {
  return graph(
    [
      node('effect', 'a', { effectId: 'a', y: 0 }),
      node('effect', 'b', { effectId: 'b', y: 100 }),
      node('mix', 'mix', { mixBlendMode: blend }),
    ],
    [
      edge('t-a', 'trigger', 'a'),
      edge('a-mix', 'a', 'mix'),
      edge('t-b', 'trigger', 'b'),
      edge('b-mix', 'b', 'mix'),
      edge('mix-out', 'mix', 'output'),
    ],
  );
}

/** The composition-relevant shape of a play/mix action, ignoring via labels. */
function shape(a: PlayAction) {
  return {
    effectId: a.effectId,
    scope: a.scope,
    targetId: a.targetId,
    mixBlendMode: a.mixBlendMode,
    mixInputs: a.mixInputs?.map((i) => [i.effectId, i.opacity, i.originNodeId]),
  };
}

describe('R13 delay = timeline shift — delay-0 parity', () => {
  it('delay 0 produces the identical Mix composition to no delay', () => {
    const withDelay = plays(evalGraph(overlapState(), mixGraph(0), 'pad', ctx())).map(shape);
    const without = plays(evalGraph(overlapState(), noDelayMixGraph(), 'pad', ctx())).map(shape);
    expect(withDelay).toEqual(without);
    // Both compose A and B in one Mix voice.
    expect(withDelay[0]?.mixInputs?.map((i) => i[0])).toEqual(['a', 'b']);
  });

  it('delay 0 emits no pending fire', () => {
    const acts = evalGraph(overlapState(), mixGraph(0), 'pad', ctx());
    expect(acts.some((a) => a.kind === 'pending')).toBe(false);
  });
});

describe('R13 delay = timeline shift — overlap-based Mix composition', () => {
  it('immediate batch composes only the layers present so far', () => {
    // Before the delayed layer starts, the Mix is just A.
    const acts = evalGraph(overlapState(), mixGraph(100), 'pad', ctx());
    const mix = plays(acts)[0]!;
    expect(mix.mixInputs?.map((i) => i.effectId)).toEqual(['a']);
    expect(onlyPending(acts).descriptor.childIds).toEqual(['b']);
  });

  it('delayed drain composes B with the still-live A, per blend rules, in y-order', () => {
    const state = overlapState(new Set(['a'])); // A's voice is still alive at drain time
    const acts = evalGraph(state, mixGraph(100, 'add'), 'pad', ctx()); // records A into the snapshot
    const pend = onlyPending(acts);
    const drained = plays(
      evalChildren(state, pend.descriptor.graph, pend.descriptor.pad, pend.descriptor.childIds, pend.descriptor.ctx, pend.descriptor.viaPrefix, pend.descriptor.seen, pend.descriptor.draft),
    )[0]!;
    expect(drained.mixBlendMode).toBe('add');
    expect(drained.mixInputs?.map((i) => i.effectId)).toEqual(['a', 'b']); // y-order: A (y=0) then B (y=100)
  });

  it('decayed layers are absent: A gone by drain time → Mix is just B', () => {
    const state = overlapState(new Set()); // nothing live at drain time
    const acts = evalGraph(state, mixGraph(100), 'pad', ctx());
    const pend = onlyPending(acts);
    const drained = plays(
      evalChildren(state, pend.descriptor.graph, pend.descriptor.pad, pend.descriptor.childIds, pend.descriptor.ctx, pend.descriptor.viaPrefix, pend.descriptor.seen, pend.descriptor.draft),
    )[0]!;
    expect(drained.mixInputs?.map((i) => i.effectId)).toEqual(['b']);
  });

  it('without the overlap machinery (no snapshots / liveness) the drain stays batch-scoped', () => {
    // Backward-compat: a bare EvalState (as used across the existing Mix suite) is untouched.
    const bare: EvalState = {
      seqIndex: new Map(), lastPick: new Map(), latched: new Map(), prng: new Prng(1),
      presetsById: new Map(), isVoiceAlive: () => false,
    };
    const acts = evalGraph(bare, mixGraph(100), 'pad', ctx());
    const pend = onlyPending(acts);
    const drained = plays(
      evalChildren(bare, pend.descriptor.graph, pend.descriptor.pad, pend.descriptor.childIds, pend.descriptor.ctx, pend.descriptor.viaPrefix, pend.descriptor.seen, pend.descriptor.draft),
    )[0]!;
    expect(drained.mixInputs?.map((i) => i.effectId)).toEqual(['b']);
  });
});
