import { describe, expect, it } from 'vitest';
import { evalChildren, evalGraph, type EvalState, type PendingAction, type PlayAction, type TriggerCtx } from './eval-graph';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });
const ctx = (velocity = 0.25): TriggerCtx => ({ velocity, sectionIndex: 0, sectionCount: 1, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });
const state = (seed = 1): EvalState => ({
  seqIndex: new Map(),
  lastPick: new Map(),
  latched: new Map(),
  prng: new Prng(seed),
  presetsById: new Map(),
  isVoiceAlive: () => false,
});
const play = (graph: TriggerGraph, velocity = 0.25): PlayAction | undefined =>
  evalGraph(state(), graph, 'pad', ctx(velocity)).find((a): a is PlayAction => a.kind === 'play');
const plays = (graph: TriggerGraph, velocity = 0.25): PlayAction[] =>
  evalGraph(state(), graph, 'pad', ctx(velocity)).filter((a): a is PlayAction => a.kind === 'play');
const pending = (graph: TriggerGraph, velocity = 0.25): PendingAction | undefined =>
  evalGraph(state(), graph, 'pad', ctx(velocity)).find((a): a is PendingAction => a.kind === 'pending');

function graph(nodes: GraphNode[], edges: GraphEdge[]): TriggerGraph {
  return { version: 3, nodes: [node('trigger', 'trigger'), ...nodes, node('output', 'output')], edges };
}

describe('evalGraph Gen3 Mix active branches', () => {
  it('emits both Output branches when one active path is longer', () => {
    const g = graph(
      [
        node('all', 'all'),
        node('effect', 'a', { effectId: 'a', x: 100, y: 0 }),
        node('effect', 'b', { effectId: 'b', x: 100, y: 100 }),
        node('scope', 'scope-b', { x: 500, y: 100, scope: 'drum', targetId: 'snare' }),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-a', 'all', 'a'),
        edge('all-b', 'all', 'b'),
        edge('a-output', 'a', 'output'),
        edge('b-scope', 'b', 'scope-b'),
        edge('scope-output', 'scope-b', 'output'),
      ],
    );

    const actions = plays(g).sort((a, b) => a.effectId.localeCompare(b.effectId));
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => [a.effectId, a.scope, a.targetId])).toEqual([
      ['a', 'kit', undefined],
      ['b', 'drum', 'snare'],
    ]);
  });

  it('emits both Output branches when edge and visual order are reversed', () => {
    const g = graph(
      [
        node('all', 'all'),
        node('effect', 'a', { effectId: 'a', x: 900, y: 100 }),
        node('effect', 'b', { effectId: 'b', x: 100, y: 0 }),
        node('scope', 'scope-b', { x: 200, y: 0, scope: 'drum', targetId: 'snare' }),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-b', 'all', 'b'),
        edge('all-a', 'all', 'a'),
        edge('b-scope', 'b', 'scope-b'),
        edge('scope-output', 'scope-b', 'output'),
        edge('a-output', 'a', 'output'),
      ],
    );

    const actions = plays(g).sort((a, b) => a.effectId.localeCompare(b.effectId));
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => [a.effectId, a.scope, a.targetId])).toEqual([
      ['a', 'kit', undefined],
      ['b', 'drum', 'snare'],
    ]);
  });

  it('does not emit inactive branches that can statically reach Output', () => {
    const g = graph(
      [
        node('all', 'all'),
        node('effect', 'live', { effectId: 'live' }),
        node('chance', 'chance', { p: 0 }),
        node('effect', 'ghost', { effectId: 'ghost' }),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-live', 'all', 'live'),
        edge('live-output', 'live', 'output'),
        edge('all-chance', 'all', 'chance'),
        edge('chance-ghost', 'chance', 'ghost'),
        edge('ghost-output', 'ghost', 'output'),
      ],
    );

    expect(plays(g).map((a) => a.effectId)).toEqual(['live']);
  });

  it('includes only the selected value-switch branch in Mix inputs', () => {
    const g = graph(
      [
        node('switch', 'sw', { valueMode: 'bands', bands: [0.5] }),
        node('effect', 'low', { effectId: 'low', y: 0 }),
        node('effect', 'high', { effectId: 'high', y: 100 }),
        node('mix', 'mix'),
      ],
      [
        edge('t-sw', 'trigger', 'sw'),
        edge('sw-low', 'sw', 'low', { fromPort: 'band-0' }),
        edge('sw-high', 'sw', 'high', { fromPort: 'band-1' }),
        edge('low-mix', 'low', 'mix'),
        edge('high-mix', 'high', 'mix'),
        edge('mix-out', 'mix', 'output'),
      ],
    );
    expect(play(g, 0.25)?.mixInputs?.map((i) => i.effectId)).toEqual(['low']);
    expect(play(g, 0.75)?.mixInputs?.map((i) => i.effectId)).toEqual(['high']);
  });

  it('does not include a disconnected branch wired into Mix', () => {
    const g = graph(
      [node('effect', 'a', { effectId: 'a' }), node('effect', 'ghost', { effectId: 'ghost' }), node('mix', 'mix')],
      [edge('t-a', 'trigger', 'a'), edge('a-mix', 'a', 'mix'), edge('ghost-mix', 'ghost', 'mix'), edge('mix-out', 'mix', 'output')],
    );
    expect(play(g)?.mixInputs?.map((i) => i.effectId)).toEqual(['a']);
  });

  it('sorts active inputs by source y and preserves per-edge opacity', () => {
    const g = graph(
      [node('all', 'all'), node('effect', 'b', { effectId: 'b', y: 100 }), node('effect', 'a', { effectId: 'a', y: 0 }), node('mix', 'mix')],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-b', 'all', 'b'),
        edge('all-a', 'all', 'a'),
        edge('b-mix', 'b', 'mix', { opacity: 0.4 }),
        edge('a-mix', 'a', 'mix', { opacity: 0.8 }),
        edge('mix-out', 'mix', 'output'),
      ],
    );
    expect(play(g)?.mixInputs?.map((i) => [i.effectId, i.opacity])).toEqual([
      ['a', 0.8],
      ['b', 0.4],
    ]);
  });

  it('does not inherit final scope or target from the first input', () => {
    const g = graph(
      [
        node('all', 'all'),
        node('effect', 'snare', { effectId: 'snare', y: 0, scope: 'drum', targetId: 'snare' }),
        node('effect', 'kick', { effectId: 'kick', y: 100, scope: 'drum', targetId: 'kick' }),
        node('mix', 'mix'),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-snare', 'all', 'snare'),
        edge('all-kick', 'all', 'kick'),
        edge('snare-mix', 'snare', 'mix'),
        edge('kick-mix', 'kick', 'mix'),
        edge('mix-out', 'mix', 'output'),
      ],
    );
    const action = play(g)!;
    expect(action.scope).toBe('kit');
    expect(action.targetId).toBeUndefined();
    expect(action.mixInputs?.map((i) => [i.scope, i.targetId])).toEqual([
      ['drum', 'snare'],
      ['drum', 'kick'],
    ]);
  });

  it('waits for visually later active branches before evaluating Mix', () => {
    const g = graph(
      [
        node('all', 'all', { x: 100 }),
        node('effect', 'late', { effectId: 'late', x: 900, y: 100 }),
        node('effect', 'early', { effectId: 'early', x: 100, y: 0 }),
        node('mix', 'mix', { x: 200, y: 0 }),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-late', 'all', 'late'),
        edge('all-early', 'all', 'early'),
        edge('early-mix', 'early', 'mix'),
        edge('late-mix', 'late', 'mix'),
        edge('mix-out', 'mix', 'output'),
      ],
    );

    expect(play(g)?.mixInputs?.map((i) => i.effectId)).toEqual(['early', 'late']);
  });

  it('does not include failed chance branches in Mix', () => {
    const g = graph(
      [node('all', 'all'), node('chance', 'chance', { p: 0 }), node('effect', 'ghost', { effectId: 'ghost' }), node('effect', 'live', { effectId: 'live' }), node('mix', 'mix')],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-chance', 'all', 'chance'),
        edge('chance-ghost', 'chance', 'ghost'),
        edge('all-live', 'all', 'live'),
        edge('ghost-mix', 'ghost', 'mix'),
        edge('live-mix', 'live', 'mix'),
        edge('mix-out', 'mix', 'output'),
      ],
    );
    expect(play(g)?.mixInputs?.map((i) => i.effectId)).toEqual(['live']);
  });

  it('applies downstream Scope after Mix to the composite action', () => {
    const g = graph(
      [node('all', 'all'), node('effect', 'a', { effectId: 'a' }), node('effect', 'b', { effectId: 'b' }), node('mix', 'mix'), node('scope', 'scope', { scope: 'drum', targetId: 'snare' })],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-a', 'all', 'a'),
        edge('all-b', 'all', 'b'),
        edge('a-mix', 'a', 'mix'),
        edge('b-mix', 'b', 'mix'),
        edge('mix-scope', 'mix', 'scope'),
        edge('scope-output', 'scope', 'output'),
      ],
    );
    expect(play(g)).toMatchObject({ scope: 'drum', targetId: 'snare' });
  });

  it('resumes delayed Gen3 branches through active Mix semantics', () => {
    const g = graph(
      [
        node('delay', 'delay', { ms: 100 }),
        node('switch', 'sw', { valueMode: 'bands', bands: [0.5] }),
        node('effect', 'low', { effectId: 'low', y: 0 }),
        node('effect', 'high', { effectId: 'high', y: 100 }),
        node('mix', 'mix'),
      ],
      [
        edge('t-delay', 'trigger', 'delay'),
        edge('delay-sw', 'delay', 'sw'),
        edge('sw-low', 'sw', 'low', { fromPort: 'band-0' }),
        edge('sw-high', 'sw', 'high', { fromPort: 'band-1' }),
        edge('low-mix', 'low', 'mix'),
        edge('high-mix', 'high', 'mix'),
        edge('mix-out', 'mix', 'output'),
      ],
    );
    const delayed = pending(g, 0.25)!;
    const resumed = evalChildren(state(), delayed.descriptor.graph, delayed.descriptor.pad, delayed.descriptor.childIds, delayed.descriptor.ctx, delayed.descriptor.viaPrefix, delayed.descriptor.seen, delayed.descriptor.draft)
      .find((a): a is PlayAction => a.kind === 'play');
    expect(resumed?.mixInputs?.map((i) => i.effectId)).toEqual(['low']);
  });
});
