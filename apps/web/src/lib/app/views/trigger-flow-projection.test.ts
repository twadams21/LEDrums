import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';
import { emptyTriggerProjectionCache, projectTriggerFlowNodes } from './trigger-flow-projection';

describe('projectTriggerFlowNodes', () => {
  it('does not reuse flow-node positions across graph keys when node ids match', () => {
    const graphA: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };
    const graphB: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 700, 800)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph: graphA,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const previousNodes = first.nodes.map((n) =>
      n.id === 'trigger' ? { ...n, position: { x: 10, y: 20 } } : n,
    );

    const second = projectTriggerFlowNodes({
      graph: graphB,
      graphKey: 'graph-b',
      selectedNodeId: null,
      previousNodes,
      cache: first.cache,
    });

    expect(second.nodes.find((n) => n.id === 'trigger')!.position).toEqual({ x: 700, y: 800 });
  });

  it('still reuses flow-node objects within the same graph when structure and selection are unchanged', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const second = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).toBe(first.nodes[0]);
  });
});
