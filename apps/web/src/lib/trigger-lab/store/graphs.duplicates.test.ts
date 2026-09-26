import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../sim';
import { duplicateGraphGroups, graphContentKey, redundantDuplicateKeys } from './graphs';

/* Exact-duplicate detection: same nodes and wires, positions included — and what is safe to
   delete (never a copy a section plays; always one copy of each graph). */

const graph = (effectId: string, x = 0): TriggerGraph => ({
  nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('effect', 'n1', x, 0, { effectId })],
  edges: [{ id: 'e1', from: 'trigger', to: 'n1' }],
});

describe('graphContentKey', () => {
  it('ignores property order but not content or position', () => {
    const a = graph('pulse');
    const reordered: TriggerGraph = { edges: a.edges, nodes: a.nodes.map((n) => Object.fromEntries(Object.entries(n).reverse()) as typeof n) };
    expect(graphContentKey(reordered)).toBe(graphContentKey(a));
    expect(graphContentKey(graph('swirl'))).not.toBe(graphContentKey(a));
    expect(graphContentKey(graph('pulse', 40))).not.toBe(graphContentKey(a));
  });
});

describe('duplicate groups and what can go', () => {
  const graphs = { a: graph('pulse'), b: graph('pulse'), c: graph('pulse'), d: graph('swirl'), e: graph('comet'), f: graph('comet') };

  it('groups identical graphs, in key order', () => {
    expect(duplicateGraphGroups(graphs)).toEqual([['a', 'b', 'c'], ['e', 'f']]);
  });

  it('keeps every copy a section plays and deletes the unused ones', () => {
    const used: Record<string, number> = { b: 1, c: 2 };
    expect(redundantDuplicateKeys(graphs, (k) => used[k] ?? 0)).toEqual(['a', 'f']);
  });

  it('keeps the first copy when no copy is used', () => {
    expect(redundantDuplicateKeys(graphs, () => 0)).toEqual(['b', 'c', 'f']);
  });

  it('never lists a graph without a twin', () => {
    expect(redundantDuplicateKeys({ d: graph('swirl') }, () => 0)).toEqual([]);
  });
});
