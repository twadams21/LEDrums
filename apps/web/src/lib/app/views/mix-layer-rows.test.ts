import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';
import { mixLayerRowsFor, mixLayerRowsSignature, mixRowHandleId } from './mix-layer-rows';

function graph(): TriggerGraph {
  return {
    nodes: [
      makeNode('effect', 'b', 0, 200),
      makeNode('effect', 'a', 0, 200),
      makeNode('modifier', 'c', 0, 50, { modifierId: 'slice' }),
      makeNode('mix', 'mix', 300, 100),
      makeNode('output', 'output', 600, 100),
    ],
    edges: [
      { id: 'edge-b', from: 'b', to: 'mix', opacity: 0.4 },
      { id: 'edge-a', from: 'a', to: 'mix', opacity: 0.8 },
      { id: 'edge-c', from: 'c', to: 'mix' },
      { id: 'edge-out', from: 'mix', to: 'output' },
    ],
  };
}

describe('mixLayerRowsFor', () => {
  it('creates one edge-backed row and target handle per incoming Mix flow edge', () => {
    const rows = mixLayerRowsFor(graph(), 'mix');
    expect(rows.map((row) => row.edgeId)).toEqual(['edge-c', 'edge-a', 'edge-b']);
    expect(rows.map((row) => row.handleId)).toEqual([
      mixRowHandleId('edge-c'),
      mixRowHandleId('edge-a'),
      mixRowHandleId('edge-b'),
    ]);
    expect(rows.map((row) => row.opacity)).toEqual([1, 0.8, 0.4]);
  });

  it('sorts by live upstream y-position with source id and edge id tiebreakers', () => {
    const rows = mixLayerRowsFor(graph(), 'mix', (id) => ({ a: 25, b: 25, c: 300 })[id]);
    expect(rows.map((row) => row.edgeId)).toEqual(['edge-a', 'edge-b', 'edge-c']);
  });

  it('keeps opacity with the edge identity when an edge is reconnected to another source', () => {
    const g = graph();
    g.edges = g.edges.map((edge) => (edge.id === 'edge-b' ? { ...edge, from: 'c', opacity: 0.33 } : edge));
    const row = mixLayerRowsFor(g, 'mix').find((r) => r.edgeId === 'edge-b');
    expect(row).toMatchObject({ fromId: 'c', opacity: 0.33, handleId: mixRowHandleId('edge-b') });
  });

  it('drops the row when its backing edge is deleted', () => {
    const g = graph();
    g.edges = g.edges.filter((edge) => edge.id !== 'edge-a');
    expect(mixLayerRowsFor(g, 'mix').map((row) => row.edgeId)).not.toContain('edge-a');
  });

  it('changes signature when live drag y-position changes, without requiring persisted graph positions', () => {
    const g = graph();
    const before = mixLayerRowsSignature(g, 'mix', (id) => ({ a: 25, b: 50, c: 75 })[id]);
    const after = mixLayerRowsSignature(g, 'mix', (id) => ({ a: 90, b: 50, c: 75 })[id]);
    expect(after).not.toBe(before);
    expect(mixLayerRowsFor(g, 'mix', (id) => ({ a: 90, b: 50, c: 75 })[id]).map((row) => row.edgeId)).toEqual([
      'edge-b',
      'edge-c',
      'edge-a',
    ]);
  });
});
