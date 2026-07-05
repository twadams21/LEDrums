import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';
import {
  emptyTriggerProjectionCache,
  projectionDesyncIds,
  projectTriggerFlowNodes,
  resetProjectionCache,
  triggerEdgeSignature,
} from './trigger-flow-projection';

describe('projectTriggerFlowNodes', () => {
  it('rebuilds a same-id node when the authoritative graph position changes under the same key', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const moved: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 700, 800)], edges: [] };

    const second = projectTriggerFlowNodes({
      graph: moved,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).not.toBe(first.nodes[0]);
    expect(second.nodes[0]!.position).toEqual({ x: 700, y: 800 });
  });

  it('rebuilds a same-id node when modulation parameter rows change its handles', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('play', 'p1', 10, 20, { effectId: 'gen:radial-wash' })],
      edges: [],
    };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const modulated: TriggerGraph = {
      nodes: [
        makeNode('play', 'p1', 10, 20, {
          effectId: 'gen:radial-wash',
          modInputs: [{ param: 'brightness' }],
        }),
      ],
      edges: [],
    };

    const second = projectTriggerFlowNodes({
      graph: modulated,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).not.toBe(first.nodes[0]);
  });

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

  // Item 1.4 regression: a selection-only change must clone the PREVIOUS flow node (live
  // position + measured handleBounds), never rebuild from the store projection — otherwise
  // selecting a just-dragged node snaps it back to its stale store position.
  it('preserves the live position when only the selection changes', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    // simulate an xyflow drag the store has not synced yet
    const dragged = first.nodes.map((n) => ({ ...n, position: { x: 500, y: 600 } }));

    const selected = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: 'trigger',
      previousNodes: dragged,
      cache: first.cache,
    });
    expect(selected.nodes[0]!.selected).toBe(true);
    expect(selected.nodes[0]!.position).toEqual({ x: 500, y: 600 }); // live position kept

    const deselected = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: selected.nodes,
      cache: selected.cache,
    });
    expect(deselected.nodes[0]!.selected).toBe(false);
    expect(deselected.nodes[0]!.position).toEqual({ x: 500, y: 600 }); // still kept on deselect
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

describe('triggerEdgeSignature', () => {
  it('includes source and target ports so handle-only wire changes rebuild edges', () => {
    expect(triggerEdgeSignature({ id: 'e1', from: 'sw', fromPort: 'band-0', to: 'p', toPort: 'in' })).not.toBe(
      triggerEdgeSignature({ id: 'e1', from: 'sw', fromPort: 'band-1', to: 'p', toPort: 'in' }),
    );
    expect(triggerEdgeSignature({ id: 'e2', from: 'env', to: 'p', toPort: 'param:brightness' })).not.toBe(
      triggerEdgeSignature({ id: 'e2', from: 'env', to: 'p', toPort: 'param:hue' }),
    );
  });
});
