import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';
import {
  emptyTriggerProjectionCache,
  projectionDesyncIds,
  projectTriggerFlowNodes,
  resetProjectionCache,
} from './trigger-flow-projection';

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

  // Incident 09 regression (extends the PR #37 suite): a graph switch must rebuild same-id
  // nodes from the NEW graph — never reuse the previous graph's node object OR its cache.
  it('rebuilds same-id nodes from the new graph after a switch (no cross-graph reuse of kind/position/cache)', () => {
    const graphA: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('random', 'x', 1, 1)],
      edges: [],
    };
    const graphB: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('toggle', 'x', 9, 9)],
      edges: [],
    };

    const first = projectTriggerFlowNodes({
      graph: graphA,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const second = projectTriggerFlowNodes({
      graph: graphB,
      graphKey: 'B',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    const x = second.nodes.find((n) => n.id === 'x')!;
    expect(x.data.kind).toBe('toggle'); // rebuilt from graphB, not reused from graphA (random)
    expect(x.position).toEqual({ x: 9, y: 9 }); // graphB position, not graphA's
    expect(second.cache.graphKey).toBe('B'); // cache re-keyed to the new graph
    expect(second.cache.nodeSigs.get('x')).toContain('toggle'); // new-graph signature written through
  });
});

describe('resetProjectionCache', () => {
  it('returns an empty sentinel (no graphKey, no signatures)', () => {
    const c = resetProjectionCache();
    expect(c.graphKey).toBeNull();
    expect(c.nodeSigs.size).toBe(0);
  });

  it('breaks cross-graph reuse when used on the error path / graph-open: a reset cache forces a full rebuild', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 5, 5)], edges: [] };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    // Same graph + key, but a reset cache (as the view assigns on a fault) → no object reuse.
    const afterReset = projectTriggerFlowNodes({
      graph,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: resetProjectionCache(),
    });
    expect(afterReset.nodes[0]).not.toBe(first.nodes[0]); // rebuilt fresh, cache was reset
    expect(afterReset.cache.graphKey).toBe('A'); // and re-established on success
  });
});

describe('projectionDesyncIds', () => {
  it('is empty when the rendered ids and the store graph agree', () => {
    expect(projectionDesyncIds(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(projectionDesyncIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]); // graph superset is fine
  });

  it('returns rendered flow-node ids missing from the store graph (the desync telemetry)', () => {
    expect(projectionDesyncIds(['a', 'ghost', 'c'], ['a', 'c'])).toEqual(['ghost']);
    expect(projectionDesyncIds(['g1', 'g2'], [])).toEqual(['g1', 'g2']);
    expect(projectionDesyncIds([], ['a'])).toEqual([]);
  });
});
