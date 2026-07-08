import { describe, expect, it } from 'vitest';
import { evalGraph, type EvalState, type TriggerCtx } from './eval-graph';
import { compileRenderPlan, nodeCategory, type RenderPlanNodeCategory } from './render-plan';
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
