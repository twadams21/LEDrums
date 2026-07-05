import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../sim';
import { normalizeGraphs, sanitizeGraphIntegrity } from './hydrate';

const graph = (): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger'),
    makeNode('play', 'p1', 100, 0, { effectId: 'gen:radial-wash' }),
    makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' }),
  ],
  edges: [
    { id: 'e1', from: 'trigger', to: 'p1' },
    { id: 'e2', from: 'ghost', to: 'p1' },
    { id: 'e3', from: 'trigger', to: 'ghost' },
    { id: 'e1', from: 'trigger', to: 'p1', fromPort: 'band-0' },
    { id: 'e4', from: 'trigger', to: 'trigger' },
    { id: 'e5', from: 'trigger', to: 'p1' },
  ],
});

describe('sanitizeGraphIntegrity', () => {
  it('drops duplicate node ids, dangling edges, duplicate edge ids, self-edges, and duplicate connections', () => {
    const clean = sanitizeGraphIntegrity(graph());

    expect(clean.nodes.map((n) => n.id)).toEqual(['trigger', 'p1']);
    expect(clean.edges).toEqual([{ id: 'e1', from: 'trigger', to: 'p1' }]);
  });

  it('keeps a valid graph by reference', () => {
    const valid: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 100, 0, { effectId: 'gen:radial-wash' })],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    };

    expect(sanitizeGraphIntegrity(valid)).toBe(valid);
  });

  it('runs inside the full normalizeGraphs load/adopt path', () => {
    const { graphs } = normalizeGraphs({ 'kick:0': graph() }, {}, [], () => [], () => undefined);

    expect(graphs['kick:0']!.nodes.map((n) => n.id)).toEqual(['trigger', 'p1']);
    expect(graphs['kick:0']!.edges).toEqual([{ id: 'e1', from: 'trigger', to: 'p1' }]);
  });
});
