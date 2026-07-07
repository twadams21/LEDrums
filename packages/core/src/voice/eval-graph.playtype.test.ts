/* D3 — typed play nodes: eval carries the node's `playType` + `canvasScene` verbatim onto
   the PlayAction (and thence the voice). Taxonomy only — nothing here branches on it. */
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

const edge = (id: string, from: string, to: string): GraphEdge => ({ id, from, to });

const state = (): EvalState => ({
  seqIndex: new Map(),
  lastPick: new Map(),
  latched: new Map(),
  prng: new Prng(1),
  presetsById: new Map(),
  isVoiceAlive: () => false,
});

describe('evalGraph Gen3 terminal output', () => {
  it('effect nodes emit only when their route reaches Output', () => {
    const loose: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 't'), node('effect', 'fx', { effectId: 'plasma' }), node('output', 'output')],
      edges: [edge('e1', 't', 'fx')],
    };
    expect(play(loose)).toBeUndefined();

    const wired: TriggerGraph = {
      version: 3,
      nodes: loose.nodes,
      edges: [edge('e1', 't', 'fx'), edge('e2', 'fx', 'output')],
    };
    expect(play(wired)?.effectId).toBe('plasma');
  });

  it('scope nodes carry legacy scoped-output targeting forward to the terminal Output', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'kit' }),
        node('scope', 'old-output', { scope: 'drum', targetId: 'snare' }),
        node('output', 'output'),
      ],
      edges: [edge('e1', 't', 'fx'), edge('e2', 'fx', 'old-output'), edge('e3', 'old-output', 'output')],
    };

    const a = play(graph)!;
    expect(a.scope).toBe('drum');
    expect(a.targetId).toBe('snare');
  });

  it('intersects cascading scopes strictly and renders nothing for an empty intersection', () => {
    const scoped: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'kit' }),
        node('scope', 'snare', { scope: 'drum', targetId: 'snare' }),
        node('scope', 'snare-hoop', { scope: 'hoop', targetId: 'snare#1' }),
        node('output', 'output'),
      ],
      edges: [edge('e1', 't', 'fx'), edge('e2', 'fx', 'snare'), edge('e3', 'snare', 'snare-hoop'), edge('e4', 'snare-hoop', 'output')],
    };

    const a = play(scoped)!;
    expect(a.scope).toBe('hoop');
    expect(a.targetId).toBe('snare#1');

    const empty: TriggerGraph = {
      ...scoped,
      nodes: scoped.nodes.map((n) => (n.id === 'snare-hoop' ? { ...n, targetId: 'kick#1' } : n)),
    };
    expect(play(empty)).toBeUndefined();
  });

  it('whole-kit Scope is a no-op and does not broaden a narrowed upstream scope', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'snare' }),
        node('scope', 'kit-scope', { scope: 'kit' }),
        node('output', 'output'),
      ],
      edges: [edge('e1', 't', 'fx'), edge('e2', 'fx', 'kit-scope'), edge('e3', 'kit-scope', 'output')],
    };

    const a = play(graph)!;
    expect(a.scope).toBe('drum');
    expect(a.targetId).toBe('snare');
  });

  it('intersects multi-hoop Scope targets without broadening them', () => {
    const scoped: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'kit' }),
        node('scope', 'outer-hoops', { scope: 'hoop', targetId: 'snare#0,2,3' }),
        node('scope', 'inner-hoops', { scope: 'hoop', targetId: 'snare#2,3' }),
        node('output', 'output', { scope: 'kit' }),
      ],
      edges: [edge('e1', 't', 'fx'), edge('e2', 'fx', 'outer-hoops'), edge('e3', 'outer-hoops', 'inner-hoops'), edge('e4', 'inner-hoops', 'output')],
    };

    const a = play(scoped)!;
    expect(a.scope).toBe('hoop');
    expect(a.targetId).toBe('snare#2,3');
  });
});

const ctx: TriggerCtx = {
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 1,
  beatPhase: 0,
  sourceDrumId: 'kick',
  bpm: 120,
};

function play(graph: TriggerGraph): PlayAction | undefined {
  return evalGraph(state(), graph, 'pad', ctx).find((a): a is PlayAction => a.kind === 'play');
}

describe('evalGraph — typed play nodes (D3)', () => {
  it('carries playType + canvasScene from a canvas play node onto the PlayAction', () => {
    const graph: TriggerGraph = {
      nodes: [
        node('trigger', 't'),
        node('play', 'p', { effectId: 'canvas:stripe-band', playType: 'canvas', canvasScene: 'stripe-band' }),
      ],
      edges: [edge('e1', 't', 'p')],
    };
    const a = play(graph)!;
    expect(a.playType).toBe('canvas');
    expect(a.canvasScene).toBe('stripe-band');
  });

  it('a hosted play node without playType (pre-migration persisted shape) still evals; fields stay undefined', () => {
    const graph: TriggerGraph = {
      nodes: [node('trigger', 't'), node('play', 'p', { effectId: 'plasma' })],
      edges: [edge('e1', 't', 'p')],
    };
    const a = play(graph)!;
    expect(a.effectId).toBe('plasma');
    expect(a.playType).toBeUndefined();
    expect(a.canvasScene).toBeUndefined();
  });
});
