import { describe, expect, it } from 'vitest';
import { describeResetNode, describeResetTarget, resetTargetOptions, sequenceNodesOf } from './reset-target';
import type { GraphNode, TriggerGraph } from '../../trigger-lab/sim';

/* Pure view-model for the reset node's target picker: which sequence nodes exist, how they are
   numbered, and how a stored (graph key, node id) target reads back. */

const node = (kind: GraphNode['kind'], id: string, x = 0, y = 0): GraphNode =>
  ({ id, kind, x, y } as unknown as GraphNode);

const graph = (...nodes: GraphNode[]): TriggerGraph => ({ version: 3, nodes, edges: [] }) as TriggerGraph;

const label = (k: string): string => ({ 'kick:0': 'Kick · center', 'graph-1': 'Footswitch' })[k] ?? k;

describe('sequenceNodesOf', () => {
  it('lists only sequence nodes, numbered from 1', () => {
    const g = graph(node('trigger', 't'), node('sequence', 's1', 0, 10), node('effect', 'fx'), node('sequence', 's2', 0, 20));
    expect(sequenceNodesOf(g)).toEqual([
      { nodeId: 's1', nodeLabel: 'Sequence 1' },
      { nodeId: 's2', nodeLabel: 'Sequence 2' },
    ]);
  });

  it('numbers in canvas reading order (top-to-bottom, then left-to-right)', () => {
    const g = graph(node('sequence', 'low', 0, 100), node('sequence', 'high', 0, 5), node('sequence', 'mid-right', 90, 50));
    expect(sequenceNodesOf(g).map((n) => n.nodeId)).toEqual(['high', 'mid-right', 'low']);
  });

  it('breaks an exact position tie by id, so the order is stable across reloads', () => {
    const g = graph(node('sequence', 'b', 5, 5), node('sequence', 'a', 5, 5));
    expect(sequenceNodesOf(g).map((n) => n.nodeId)).toEqual(['a', 'b']);
  });

  it('returns nothing for a missing graph or a graph with no sequence nodes', () => {
    expect(sequenceNodesOf(undefined)).toEqual([]);
    expect(sequenceNodesOf(graph(node('trigger', 't'), node('effect', 'fx')))).toEqual([]);
  });
});

describe('resetTargetOptions', () => {
  const graphs = {
    'kick:0': graph(node('trigger', 't'), node('sequence', 'seq', 0, 10)),
    'graph-1': graph(node('trigger', 't'), node('reset', 'r')), // no sequence node
    'graph-2': graph(node('sequence', 'x', 0, 1), node('sequence', 'y', 0, 2)),
  };

  it('flattens every sequence node across graphs, with both labels resolved', () => {
    expect(resetTargetOptions(graphs, Object.keys(graphs), label)).toEqual([
      { graphKey: 'kick:0', nodeId: 'seq', graphLabel: 'Kick · center', nodeLabel: 'Sequence 1' },
      { graphKey: 'graph-2', nodeId: 'x', graphLabel: 'graph-2', nodeLabel: 'Sequence 1' },
      { graphKey: 'graph-2', nodeId: 'y', graphLabel: 'graph-2', nodeLabel: 'Sequence 2' },
    ]);
  });

  it('omits graphs with no sequence node — there is nothing to reset in them', () => {
    expect(resetTargetOptions(graphs, Object.keys(graphs), label).some((o) => o.graphKey === 'graph-1')).toBe(false);
  });

  it('follows the caller-supplied graph key order', () => {
    const keys = ['graph-2', 'kick:0'];
    expect(resetTargetOptions(graphs, keys, label).map((o) => o.graphKey)).toEqual(['graph-2', 'graph-2', 'kick:0']);
  });

  it('is empty when the show has no sequence nodes at all', () => {
    expect(resetTargetOptions({ a: graph(node('trigger', 't')) }, ['a'], label)).toEqual([]);
  });
});

describe('describeResetTarget', () => {
  const options = resetTargetOptions({ 'kick:0': graph(node('sequence', 'seq')) }, ['kick:0'], label);

  it('reads back a resolved target as "graph · node"', () => {
    expect(describeResetTarget({ targetGraphKey: 'kick:0', targetNodeId: 'seq' }, options)).toBe('Kick · center · Sequence 1');
  });

  it('says "no target" when either half is unset', () => {
    expect(describeResetTarget({ targetGraphKey: undefined, targetNodeId: undefined }, options)).toBe('no target');
    expect(describeResetTarget({ targetGraphKey: 'kick:0', targetNodeId: undefined }, options)).toBe('no target');
    expect(describeResetTarget({ targetGraphKey: undefined, targetNodeId: 'seq' }, options)).toBe('no target');
  });

  it('says "target missing" when the stored target no longer exists', () => {
    // eval silently skips a dangling target, so the UI is the only place it is visible
    expect(describeResetTarget({ targetGraphKey: 'deleted', targetNodeId: 'seq' }, options)).toBe('target missing');
    expect(describeResetTarget({ targetGraphKey: 'kick:0', targetNodeId: 'gone' }, options)).toBe('target missing');
  });
});

describe('describeResetNode', () => {
  const options = resetTargetOptions({ 'kick:0': graph(node('sequence', 'seq')) }, ['kick:0'], label);
  const describeSource = (s: GraphNode['source']): string =>
    s?.kind === 'midi' ? `MIDI note ${s.note}` : s?.kind === 'osc' ? `OSC ${s.address}` : 'unbound';

  it('leads with the reset’s own input when it is self-hosted', () => {
    const bound = { targetGraphKey: 'kick:0', targetNodeId: 'seq', source: { kind: 'midi', note: 61 } as const };
    expect(describeResetNode(bound, options, describeSource)).toBe('MIDI note 61 → Kick · center · Sequence 1');
  });

  it('shows the target alone when the reset fires from the graph trigger', () => {
    const unbound = { targetGraphKey: 'kick:0', targetNodeId: 'seq', source: undefined };
    expect(describeResetNode(unbound, options, describeSource)).toBe('Kick · center · Sequence 1');
  });

  it('still reports a missing target alongside a binding', () => {
    const bound = { targetGraphKey: 'gone', targetNodeId: 'seq', source: { kind: 'midi', note: 61 } as const };
    expect(describeResetNode(bound, options, describeSource)).toBe('MIDI note 61 → target missing');
  });
});
