import { describe, expect, it } from 'vitest';
import { evalChildren, evalGraph, type EvalState, type PendingAction, type PlayAction, type TriggerCtx } from './eval-graph';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

/*
 * R14 — Fan-in to one Effect coalesces to a single firing (GH #93).
 *
 * Multiple flow edges converging on ONE Effect node must produce a single firing per
 * trigger — the play draft is a pure function of the node, so N converging edges would
 * otherwise emit N identical voices (double / N× brightness). A delayed branch re-arriving
 * at the same Effect drains in a SEPARATE eval batch (a fresh `evalChildren` call) and is a
 * distinct temporal firing under the R13 timeline model — NOT folded into the immediate one.
 *
 * Defined against R13's settled temporal model (eval-graph.delay-timeline.test.ts): this
 * file asserts the render-time multiplicity, R13 asserts the composition membership.
 */

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5, invert: false,
    bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });
const ctx = (velocity = 1): TriggerCtx => ({ velocity, sectionIndex: 0, sectionCount: 1, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });

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

/** Two flow paths converge on ONE Effect X: trigger → p → X and trigger → q → X. */
function faninGraph(): TriggerGraph {
  return graph(
    [
      node('all', 'p', { y: 0 }),
      node('all', 'q', { y: 100 }),
      node('effect', 'x', { effectId: 'x' }),
    ],
    [
      edge('t-p', 'trigger', 'p'),
      edge('t-q', 'trigger', 'q'),
      edge('p-x', 'p', 'x'),
      edge('q-x', 'q', 'x'),
      edge('x-out', 'x', 'output'),
    ],
  );
}

/** Two DIFFERENT effects into output — genuine multiplicity that must NOT be coalesced. */
function twoEffectsGraph(): TriggerGraph {
  return graph(
    [
      node('effect', 'a', { effectId: 'a', y: 0 }),
      node('effect', 'b', { effectId: 'b', y: 100 }),
    ],
    [
      edge('t-a', 'trigger', 'a'),
      edge('t-b', 'trigger', 'b'),
      edge('a-out', 'a', 'output'),
      edge('b-out', 'b', 'output'),
    ],
  );
}

/** Fan-in (p, q) into X PLUS a delayed branch into the SAME X. */
function faninPlusDelayGraph(ms: number): TriggerGraph {
  return graph(
    [
      node('all', 'p', { y: 0 }),
      node('all', 'q', { y: 100 }),
      node('delay', 'delay', { ms }),
      node('effect', 'x', { effectId: 'x' }),
    ],
    [
      edge('t-p', 'trigger', 'p'),
      edge('t-q', 'trigger', 'q'),
      edge('p-x', 'p', 'x'),
      edge('q-x', 'q', 'x'),
      edge('t-delay', 'trigger', 'delay'),
      edge('delay-x', 'delay', 'x'),
      edge('x-out', 'x', 'output'),
    ],
  );
}

describe('R14 fan-in coalescing — one Effect, one firing per trigger', () => {
  it('two flow edges into one Effect coalesce to a single firing', () => {
    const acts = plays(evalGraph(overlapState(), faninGraph(), 'pad', ctx()));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.effectId).toBe('x');
  });

  it('distinct effects into output are NOT coalesced (real multiplicity preserved)', () => {
    const acts = plays(evalGraph(overlapState(), twoEffectsGraph(), 'pad', ctx()));
    expect(acts.map((a) => a.effectId)).toEqual(['a', 'b']);
  });

  it('coalescing holds regardless of trigger velocity / batch order', () => {
    // Same graph, several velocities — always exactly one firing.
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(plays(evalGraph(overlapState(), faninGraph(), 'pad', ctx(v)))).toHaveLength(1);
    }
  });
});

describe('R14 fan-in coalescing — delayed re-arrival is a separate temporal firing', () => {
  it('immediate fan-in coalesces to one; the delayed branch fires separately on drain', () => {
    const state = overlapState();
    const acts = evalGraph(state, faninPlusDelayGraph(100), 'pad', ctx());

    // Immediate batch: p and q both reach X → one coalesced firing (not two).
    expect(plays(acts)).toHaveLength(1);
    const pend = onlyPending(acts);
    expect(pend.descriptor.childIds).toEqual(['x']);

    // Delayed drain re-enters eval fresh: X fires once more — a distinct temporal firing.
    const drained = plays(
      evalChildren(state, pend.descriptor.graph, pend.descriptor.pad, pend.descriptor.childIds, pend.descriptor.ctx, pend.descriptor.viaPrefix, pend.descriptor.seen, pend.descriptor.draft),
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]!.effectId).toBe('x');
  });

  it('delay 0 folds inline and still coalesces to a single firing', () => {
    // With delayMs<=0 the delay fires inline in the same batch, so p, q and the delay path
    // all reach X in one batch → still exactly one firing.
    const acts = plays(evalGraph(overlapState(), faninPlusDelayGraph(0), 'pad', ctx()));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.effectId).toBe('x');
  });
});
