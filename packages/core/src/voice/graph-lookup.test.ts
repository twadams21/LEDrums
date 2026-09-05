import { describe, expect, it } from 'vitest';
import { graphAt } from './graph-lookup';
import type { TriggerGraph } from './types';

describe('graphAt', () => {
  it('returns only an own graph key, never an inherited or prototype property', () => {
    const graph = { nodes: [], edges: [] } satisfies TriggerGraph;
    const graphs: Record<string, TriggerGraph> = { own: graph };
    Object.setPrototypeOf(graphs, { inherited: graph });

    expect(graphAt(graphs, 'own')).toBe(graph);
    expect(graphAt(graphs, 'inherited')).toBeUndefined();
    expect(graphAt(graphs, 'toString')).toBeUndefined();
    expect(graphAt(graphs, undefined)).toBeUndefined();
  });
});
