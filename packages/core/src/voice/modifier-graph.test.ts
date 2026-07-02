import { describe, it, expect } from 'vitest';
import { resolveModifierChain } from './modifier-graph';
import { evalGraph, type EvalState, type PlayAction, type TriggerCtx } from './eval-graph';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

/** Minimal all-kinds GraphNode (only the fields for its `kind` matter). */
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
    linked: false,
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

function edge(id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return { id, from, to, ...over };
}

const mod = (id: string, modifierId: string, over: Partial<GraphNode> = {}): GraphNode =>
  node('modifier', id, { modifierId, ...over });

function freshState(): EvalState {
  return {
    seqIndex: new Map(),
    lastPick: new Map(),
    latched: new Map(),
    prng: new Prng(1),
    presetsById: new Map(),
    isVoiceAlive: () => false,
  };
}

const ctx: TriggerCtx = {
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 1,
  beatPhase: 0,
  sourceDrumId: 'kick',
  bpm: 120,
};

/** Run the graph from its trigger node and pull the first play action's modifier chain. */
function firstPlay(graph: TriggerGraph): PlayAction | undefined {
  return evalGraph(freshState(), graph, 'pad', ctx).find((a): a is PlayAction => a.kind === 'play');
}

describe('resolveModifierChain (pure)', () => {
  it('returns [] for a play node with no mod wires', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const graph: TriggerGraph = { nodes: [play], edges: [] };
    expect(resolveModifierChain(graph, play)).toEqual([]);
  });

  it('resolves a single Trail → play mod wire', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const trail = mod('m', 'trail', { params: { decayMs: 300, mode: 'max' } });
    const graph: TriggerGraph = {
      nodes: [play, trail],
      edges: [edge('e', 'm', 'p', { toPort: 'mod' })],
    };
    expect(resolveModifierChain(graph, play)).toEqual([
      { modifierId: 'trail', params: { decayMs: 300, mode: 'max' } },
    ]);
  });

  it('ignores non-mod (trigger-flow) edges into the play node', () => {
    const trig = node('trigger', 'trigger');
    const play = node('play', 'p', { effectId: 'fx' });
    const trail = mod('m', 'trail');
    const graph: TriggerGraph = {
      nodes: [trig, play, trail],
      edges: [
        edge('e0', 'trigger', 'p'), // trigger-flow wire (toPort undefined) — not a modifier
        edge('e1', 'm', 'p', { toPort: 'mod' }),
      ],
    };
    expect(resolveModifierChain(graph, play).map((m) => m.modifierId)).toEqual(['trail']);
  });

  it('ignores a mod edge whose source is not a modifier node', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const other = node('all', 'a');
    const graph: TriggerGraph = {
      nodes: [play, other],
      edges: [edge('e', 'a', 'p', { toPort: 'mod' })],
    };
    expect(resolveModifierChain(graph, play)).toEqual([]);
  });

  it('orders parallel mod wires by source y-position', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const low = mod('lo', 'bloom', { y: 10 });
    const high = mod('hi', 'grain', { y: 90 });
    const graph: TriggerGraph = {
      nodes: [play, high, low], // deliberately out of y-order in the array
      edges: [
        edge('e0', 'hi', 'p', { toPort: 'mod' }),
        edge('e1', 'lo', 'p', { toPort: 'mod' }),
      ],
    };
    expect(resolveModifierChain(graph, play).map((m) => m.modifierId)).toEqual(['bloom', 'grain']);
  });

  it('resolves an explicit mod→mod chain front-to-back (Grain → Bloom → Play)', () => {
    // Grain feeds Bloom's mod input; Bloom feeds Play's mod input.
    const play = node('play', 'p', { effectId: 'fx' });
    const bloom = mod('bl', 'bloom');
    const grain = mod('gr', 'grain');
    const graph: TriggerGraph = {
      nodes: [play, bloom, grain],
      edges: [
        edge('e0', 'gr', 'bl', { toPort: 'mod' }),
        edge('e1', 'bl', 'p', { toPort: 'mod' }),
      ],
    };
    // Applied order: Grain first (upstream), then Bloom.
    expect(resolveModifierChain(graph, play).map((m) => m.modifierId)).toEqual(['grain', 'bloom']);
  });

  it('carries bypass through and omits it when false', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const on = mod('a', 'trail', { y: 0, bypass: true });
    const off = mod('b', 'grain', { y: 10, bypass: false });
    const graph: TriggerGraph = {
      nodes: [play, on, off],
      edges: [
        edge('e0', 'a', 'p', { toPort: 'mod' }),
        edge('e1', 'b', 'p', { toPort: 'mod' }),
      ],
    };
    const chain = resolveModifierChain(graph, play);
    expect(chain[0]).toEqual({ modifierId: 'trail', params: {}, bypass: true });
    expect(chain[1]).toEqual({ modifierId: 'grain', params: {} });
  });

  it('a shared modifier node feeding two play nodes yields equal params (independent state comes later)', () => {
    const p1 = node('play', 'p1', { effectId: 'fx' });
    const p2 = node('play', 'p2', { effectId: 'fx' });
    const shared = mod('s', 'trail', { params: { decayMs: 500 } });
    const graph: TriggerGraph = {
      nodes: [p1, p2, shared],
      edges: [
        edge('e0', 's', 'p1', { toPort: 'mod' }),
        edge('e1', 's', 'p2', { toPort: 'mod' }),
      ],
    };
    const c1 = resolveModifierChain(graph, p1);
    const c2 = resolveModifierChain(graph, p2);
    expect(c1).toEqual(c2);
    expect(c1).toEqual([{ modifierId: 'trail', params: { decayMs: 500 } }]);
  });

  it('does not loop on a cyclic mod graph (guarded)', () => {
    // a → b → a (both modifier nodes) plus b → play
    const play = node('play', 'p', { effectId: 'fx' });
    const a = mod('a', 'grain');
    const b = mod('b', 'bloom');
    const graph: TriggerGraph = {
      nodes: [play, a, b],
      edges: [
        edge('e0', 'a', 'b', { toPort: 'mod' }),
        edge('e1', 'b', 'a', { toPort: 'mod' }),
        edge('e2', 'b', 'p', { toPort: 'mod' }),
      ],
    };
    // A cycle is pathological (the connect validator rejects it); the guarantee here is only
    // that resolution TERMINATES, stays bounded, and yields known ids — never loops forever.
    const ids = resolveModifierChain(graph, play).map((m) => m.modifierId);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids.every((id) => id === 'grain' || id === 'bloom')).toBe(true);
  });
});

describe('eval-graph integration', () => {
  it('populates PlayAction.modifiers from the play node mod chain', () => {
    const trig = node('trigger', 'trigger');
    const play = node('play', 'p', { effectId: 'fx' });
    const trail = mod('m', 'trail', { params: { decayMs: 250 } });
    const graph: TriggerGraph = {
      nodes: [trig, play, trail],
      edges: [
        edge('e0', 'trigger', 'p'),
        edge('e1', 'm', 'p', { toPort: 'mod' }),
      ],
    };
    const play0 = firstPlay(graph);
    expect(play0?.modifiers).toEqual([{ modifierId: 'trail', params: { decayMs: 250 } }]);
  });

  it('leaves modifiers undefined when nothing is wired (hot path preserved)', () => {
    const trig = node('trigger', 'trigger');
    const play = node('play', 'p', { effectId: 'fx' });
    const graph: TriggerGraph = { nodes: [trig, play], edges: [edge('e0', 'trigger', 'p')] };
    expect(firstPlay(graph)?.modifiers).toBeUndefined();
  });

  it('a modifier node is inert in trigger-flow eval (never fires children)', () => {
    // trigger → modifier → play: the modifier does NOT forward the flow, so no play fires.
    const trig = node('trigger', 'trigger');
    const modNode = mod('m', 'trail');
    const play = node('play', 'p', { effectId: 'fx' });
    const graph: TriggerGraph = {
      nodes: [trig, modNode, play],
      edges: [
        edge('e0', 'trigger', 'm'),
        edge('e1', 'm', 'p'),
      ],
    };
    const actions = evalGraph(freshState(), graph, 'pad', ctx);
    expect(actions).toEqual([]);
  });
});
