import { describe, expect, it } from 'vitest';
import { evalGraph, type EvalState, type TriggerCtx } from './eval-graph';
import {
  compileRenderPlan,
  createRenderPlanCache,
  nodeCategory,
  renderPlanSignature,
  type RenderPlanNodeCategory,
} from './render-plan';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, NodeKind, TriggerGraph } from './types';

function node(kind: NodeKind, id: string, over: Partial<GraphNode> = {}): GraphNode {
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

const ctx: TriggerCtx = {
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 1,
  beatPhase: 0,
  sourceDrumId: 'kick',
  bpm: 120,
};

const state = (): EvalState => ({
  seqIndex: new Map(),
  lastPick: new Map(),
  latched: new Map(),
  prng: new Prng(1),
  presetsById: new Map(),
  isVoiceAlive: () => false,
});

describe('compileRenderPlan', () => {
  it('categorises every supported node kind explicitly', () => {
    const cases: Array<[NodeKind, RenderPlanNodeCategory]> = [
      ['trigger', 'trigger-source'],
      ['all', 'route-control'],
      ['random', 'route-control'],
      ['sequence', 'route-control'],
      ['switch', 'route-control'],
      ['chance', 'route-control'],
      ['toggle', 'route-control'],
      ['delay', 'route-control'],
      ['effect', 'layer-producer'],
      ['play', 'layer-producer'],
      ['scope', 'layer-transform'],
      ['modifier', 'layer-transform'],
      ['mix', 'collector'],
      ['output', 'collector'],
      ['envelope', 'modulation-source'],
      ['lfo', 'modulation-source'],
      ['cc', 'modulation-source'],
      ['note', 'modulation-source'],
      ['osc', 'modulation-source'],
      ['randomMod', 'modulation-source'],
    ];

    for (const [kind, category] of cases) expect(nodeCategory(kind)).toBe(category);
  });

  it('recognises graph boundary anchors and ignores modulation side-channel edges in flow adjacency', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma' }),
        node('envelope', 'env'),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-fx', 'trigger', 'fx'),
        edge('env-fx', 'env', 'fx', { toPort: 'param:brightness' }),
        edge('fx-output', 'fx', 'output'),
      ],
    };

    const plan = compileRenderPlan(graph);

    expect(plan.fatal).toBe(false);
    expect(plan.triggerId).toBe('trigger');
    expect(plan.outputId).toBe('output');
    expect(plan.planNodesById.get('env')?.category).toBe('modulation-source');
    expect(plan.flowChildrenById.get('env')).toEqual([]);
    expect(plan.incomingFlowEdgesById.get('fx')?.map((e) => e.id)).toEqual(['trigger-fx']);
  });

  it('rejects non-trivial flow cycles at compile time', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('all', 'a'),
        node('effect', 'fx', { effectId: 'plasma' }),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-a', 'trigger', 'a'),
        edge('a-fx', 'a', 'fx'),
        edge('fx-a', 'fx', 'a'),
        edge('fx-output', 'fx', 'output'),
      ],
    };

    const plan = compileRenderPlan(graph);

    expect(plan.fatal).toBe(true);
    expect(plan.issues.map((issue) => issue.code)).toContain('flow-cycle');
    expect(evalGraph(state(), graph, 'pad', ctx)).toEqual([]);
  });
});

/** trigger → fx(effectId) → output — the smallest graph that emits a play action. */
function linearGraph(): TriggerGraph {
  return {
    version: 3,
    nodes: [node('trigger', 'trigger'), node('effect', 'fx', { effectId: 'plasma', y: 1 }), node('output', 'output', { y: 2 })],
    edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
  };
}

describe('renderPlanSignature', () => {
  it('is stable for an unchanged graph and moves for each structural edit class', () => {
    const base = renderPlanSignature(linearGraph());
    expect(renderPlanSignature(linearGraph())).toBe(base);

    const mutate = (fn: (g: TriggerGraph) => void): string => {
      const g = linearGraph();
      fn(g);
      return renderPlanSignature(g);
    };

    // add node, remove node, change kind, move node (y), add edge, remove edge, retarget port.
    expect(mutate((g) => g.nodes.push(node('all', 'a', { y: 3 })))).not.toBe(base);
    expect(mutate((g) => g.nodes.pop())).not.toBe(base);
    expect(mutate((g) => (g.nodes[1]!.kind = 'all'))).not.toBe(base);
    expect(mutate((g) => (g.nodes[1]!.y = 99))).not.toBe(base);
    expect(mutate((g) => g.edges.push(edge('t-o', 'trigger', 'output')))).not.toBe(base);
    expect(mutate((g) => g.edges.pop())).not.toBe(base);
    expect(mutate((g) => (g.edges[0]!.toPort = 'mod'))).not.toBe(base);
  });

  it('is unmoved by param-only edits (params are not part of plan structure)', () => {
    const base = renderPlanSignature(linearGraph());
    const withParams = linearGraph();
    withParams.nodes[1]!.effectId = 'strobe';
    withParams.nodes[1]!.mode = 'loop';
    withParams.nodes[1]!.mixBlendMode = 'add';
    withParams.nodes[1]!.params = { brightness: 0.4 };
    expect(renderPlanSignature(withParams)).toBe(base);
  });
});

describe('createRenderPlanCache', () => {
  it('reuses the compiled plan (same object, no recompile) for an unchanged graph', () => {
    const cache = createRenderPlanCache();
    const graph = linearGraph();
    const first = cache.compile(graph);
    const second = cache.compile(graph);
    expect(second).toBe(first);
    expect(cache.compileCount).toBe(1);
  });

  it('invalidates on every structural edit class (in-place mutation)', () => {
    const edits: Array<[string, (g: TriggerGraph) => void]> = [
      ['add node', (g) => g.nodes.push(node('all', 'a', { y: 3 }))],
      ['remove node', (g) => g.nodes.pop()],
      ['change kind', (g) => (g.nodes[1]!.kind = 'all')],
      ['move node (y)', (g) => (g.nodes[1]!.y = 99)],
      ['add edge', (g) => g.edges.push(edge('t-o', 'trigger', 'output'))],
      ['remove edge', (g) => g.edges.pop()],
      ['retarget flow→mod', (g) => (g.edges[0]!.toPort = 'mod')],
    ];
    for (const [, apply] of edits) {
      const cache = createRenderPlanCache();
      const graph = linearGraph();
      const before = cache.compile(graph);
      apply(graph); // same object, mutated in place — object identity alone cannot see this
      const after = cache.compile(graph);
      expect(after).not.toBe(before);
      expect(cache.compileCount).toBe(2);
    }
  });

  it('reuses across a param-only edit (params read off live nodes, not the plan)', () => {
    const cache = createRenderPlanCache();
    const graph = linearGraph();
    const before = cache.compile(graph);
    graph.nodes[1]!.effectId = 'strobe';
    graph.nodes[1]!.mode = 'loop';
    graph.nodes[1]!.mixBlendMode = 'add';
    const after = cache.compile(graph);
    expect(after).toBe(before);
    expect(cache.compileCount).toBe(1);
  });

  it('keys per graph object — distinct graphs do not evict each other', () => {
    const cache = createRenderPlanCache();
    const g1 = linearGraph();
    const g2 = linearGraph();
    const p1 = cache.compile(g1);
    const p2 = cache.compile(g2);
    expect(p2).not.toBe(p1);
    expect(cache.compileCount).toBe(2);
    // g1 is still cached — alternating fires across pads must not thrash a single slot.
    expect(cache.compile(g1)).toBe(p1);
    expect(cache.compileCount).toBe(2);
  });

  it('reset() drops cached plans', () => {
    const cache = createRenderPlanCache();
    const graph = linearGraph();
    const before = cache.compile(graph);
    cache.reset();
    const after = cache.compile(graph);
    expect(after).not.toBe(before);
    expect(cache.compileCount).toBe(2);
  });
});

describe('render-plan cache parity', () => {
  // trigger → sequence → [fxA, fxB] → output: state (seqIndex) advances per hit, so a stale or
  // shared plan would show up as diverging actions across the roll.
  function rollGraph(): TriggerGraph {
    return {
      version: 3,
      nodes: [
        node('trigger', 'trigger', { y: 0 }),
        node('sequence', 'seq', { y: 1 }),
        node('effect', 'fxA', { effectId: 'plasma', y: 2 }),
        node('effect', 'fxB', { effectId: 'strobe', y: 3 }),
        node('output', 'output', { y: 4 }),
      ],
      edges: [
        edge('t-seq', 'trigger', 'seq'),
        edge('seq-a', 'seq', 'fxA'),
        edge('seq-b', 'seq', 'fxB'),
        edge('a-out', 'fxA', 'output'),
        edge('b-out', 'fxB', 'output'),
      ],
    };
  }

  it('produces identical actions with and without the cache across a fast roll', () => {
    const graph = rollGraph();
    const cached = { ...state(), renderPlanCache: createRenderPlanCache() };
    const plain = state();
    for (let hit = 0; hit < 8; hit++) {
      const withCache = evalGraph(cached, graph, 'pad', ctx);
      const withoutCache = evalGraph(plain, graph, 'pad', ctx);
      expect(withCache).toEqual(withoutCache);
    }
    // The cache actually engaged: one compile served all 8 hits.
    expect(cached.renderPlanCache!.compileCount).toBe(1);
  });

  it('stays in parity when the graph is structurally edited mid-roll', () => {
    const cachedGraph = rollGraph();
    const plainGraph = rollGraph();
    const cached = { ...state(), renderPlanCache: createRenderPlanCache() };
    const plain = state();

    const hitBoth = (): void => {
      expect(evalGraph(cached, cachedGraph, 'pad', ctx)).toEqual(evalGraph(plain, plainGraph, 'pad', ctx));
    };

    hitBoth();
    hitBoth();
    // Structural edit applied identically to both graphs: drop fxB from the sequence.
    for (const g of [cachedGraph, plainGraph]) {
      g.nodes = g.nodes.filter((n) => n.id !== 'fxB');
      g.edges = g.edges.filter((e) => e.from !== 'fxB' && e.to !== 'fxB');
    }
    hitBoth();
    hitBoth();
    // Edit forced exactly one recompile in the cached path (initial + post-edit).
    expect(cached.renderPlanCache!.compileCount).toBe(2);
  });
});
