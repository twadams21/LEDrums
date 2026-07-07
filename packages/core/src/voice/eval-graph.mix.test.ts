import { describe, expect, it } from 'vitest';
import { evalGraph, type EvalState, type PlayAction, type TriggerCtx } from './eval-graph';
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

function graph(nodes: GraphNode[], edges: GraphEdge[]): TriggerGraph {
  return { version: 3, nodes: [node('trigger', 'trigger'), ...nodes, node('output', 'output')], edges };
}

describe('evalGraph Gen3 Mix active branches', () => {
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
});
