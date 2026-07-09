import { describe, expect, it } from 'vitest';
import { normalizeTriggerGraphToGen3 } from './graph-integrity';
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

describe('normalizeTriggerGraphToGen3', () => {
  it('migrates legacy play leaves to effect nodes wired through one output anchor', () => {
    const graph: TriggerGraph = {
      nodes: [node('trigger', 'trigger'), node('play', 'p', { effectId: 'fx' })],
      edges: [edge('e1', 'trigger', 'p')],
    };
    const { graph: next, issues } = normalizeTriggerGraphToGen3(graph);
    expect(issues).toEqual([]);
    expect(next.version).toBe(3);
    expect(next.nodes.filter((n) => n.kind === 'output')).toHaveLength(1);
    expect(next.nodes.find((n) => n.id === 'p')?.kind).toBe('effect');
    expect(next.edges).toContainEqual(expect.objectContaining({ from: 'p', to: 'output' }));
  });

  it('converts legacy scoped output nodes to scope filters before adding terminal output', () => {
    const graph: TriggerGraph = {
      nodes: [node('trigger', 'trigger'), node('play', 'p'), node('output', 'legacy-out', { scope: 'drum', targetId: 'snare' })],
      edges: [edge('e1', 'trigger', 'p'), edge('e2', 'p', 'legacy-out')],
    };
    const { graph: next } = normalizeTriggerGraphToGen3(graph);
    expect(next.nodes.find((n) => n.id === 'legacy-out')).toMatchObject({ kind: 'scope', scope: 'drum', targetId: 'snare' });
    expect(next.nodes.filter((n) => n.kind === 'output').map((n) => n.id)).toEqual(['output']);
    expect(next.edges).toContainEqual(expect.objectContaining({ from: 'legacy-out', to: 'output' }));
  });

  it('repairs duplicate outputs duplicate ids dangling self and duplicate edges deterministically', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'p'),
        node('effect', 'p'),
        node('output', 'output'),
        node('output', 'extra'),
      ],
      edges: [
        edge('e1', 'trigger', 'p'),
        edge('e1', 'trigger', 'p'),
        edge('self', 'p', 'p'),
        edge('dangling', 'p', 'missing'),
        edge('dup-connection', 'trigger', 'p'),
      ],
    };
    const { graph: next, issues } = normalizeTriggerGraphToGen3(graph);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining([
      'duplicate-output',
      'duplicate-node-id',
      'duplicate-edge-id',
      'self-edge',
      'dangling-edge',
      'duplicate-connection',
    ]));
    expect(next.nodes.filter((n) => n.kind === 'output')).toHaveLength(1);
    expect(next.nodes.filter((n) => n.id === 'p')).toHaveLength(1);
    expect(next.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('flags Gen3 persisted play and uses only flow edges for render leaf detection', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('play', 'p'), node('envelope', 'env'), node('modifier', 'mod'), node('output', 'output')],
      edges: [
        edge('e1', 'trigger', 'p'),
        edge('param', 'env', 'p', { toPort: 'param:brightness' }),
        edge('mod', 'p', 'mod', { toPort: 'mod' }),
      ],
    };
    const { graph: next, issues } = normalizeTriggerGraphToGen3(graph);
    expect(issues.map((i) => i.code)).toContain('persisted-play-in-gen3');
    expect(next.nodes.find((n) => n.id === 'p')?.kind).toBe('effect');
    expect(next.edges).not.toContainEqual(expect.objectContaining({ from: 'p', to: 'output' }));
  });

  it('reports the system actions performed: legacy migration + auto-wired leaf count', () => {
    const graph: TriggerGraph = {
      nodes: [node('trigger', 'trigger'), node('play', 'a', { effectId: 'fx' }), node('play', 'b', { effectId: 'fx' })],
      edges: [edge('e1', 'trigger', 'a'), edge('e2', 'trigger', 'b')],
    };
    const { actions } = normalizeTriggerGraphToGen3(graph);
    expect(actions).toEqual({ migratedToGen3: true, autoWiredToOutput: 2 });
  });

  it('reports no system actions for an already-Gen3, fully-wired graph', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'p', { effectId: 'fx' }), node('output', 'output')],
      edges: [edge('e1', 'trigger', 'p'), edge('e2', 'p', 'output')],
    };
    const { actions } = normalizeTriggerGraphToGen3(graph);
    expect(actions).toEqual({ migratedToGen3: false, autoWiredToOutput: 0 });
  });

  it('is idempotent after the first repair pass', () => {
    const once = normalizeTriggerGraphToGen3({ nodes: [node('trigger', 'trigger'), node('play', 'p')], edges: [] }).graph;
    const twice = normalizeTriggerGraphToGen3(once);
    expect(twice.issues).toEqual([]);
    expect(twice.graph).toEqual(once);
  });

  it('does not auto-wire an already-Gen3 unwired effect leaf', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'p', { effectId: 'fx' }), node('output', 'output')],
      edges: [edge('e1', 'trigger', 'p')],
    };
    const { graph: next } = normalizeTriggerGraphToGen3(graph);
    expect(next.edges).toEqual([edge('e1', 'trigger', 'p')]);
  });

  it('reserves the terminal output id for the output anchor', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'output', { effectId: 'fx' }), node('output', 'out2')],
      edges: [edge('e1', 'trigger', 'output'), edge('e2', 'output', 'out2')],
    };
    const { graph: next, issues } = normalizeTriggerGraphToGen3(graph);
    expect(issues.map((i) => i.code)).toContain('reserved-output-id');
    expect(next.nodes.filter((n) => n.kind === 'output').map((n) => n.id)).toEqual(['output']);
    const remapped = next.nodes.find((n) => n.kind === 'effect');
    expect(remapped?.id).not.toBe('output');
    expect(next.edges).toContainEqual(expect.objectContaining({ from: 'trigger', to: remapped?.id }));
    expect(next.edges).toContainEqual(expect.objectContaining({ from: remapped?.id, to: 'output' }));
  });
});
