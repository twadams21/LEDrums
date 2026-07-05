/* D3 hydrate migration — persisted play nodes without `playType` infer it from their
   effect id (U1's first-tag collection derivation, total mapping). */
import { describe, expect, it } from 'vitest';
import { inferPlayTypes } from './hydrate';
import { makeNode, type TriggerGraph } from '../sim';

const graphOf = (nodes: TriggerGraph['nodes']): Record<string, TriggerGraph> => ({
  g: { nodes, edges: [] },
});

describe('inferPlayTypes (D3 hydrate migration)', () => {
  it('infers a missing playType from the effect id via the shared collection derivation', () => {
    const play = makeNode('play', 'p', 0, 0, { effectId: 'plasma' });
    expect(play.playType).toBeUndefined();
    const out = inferPlayTypes(graphOf([play]));
    expect(out.g!.nodes[0]!.playType).toBe('textures');
  });

  it('a canvasScene-bearing node infers canvas; existing playType is kept (idempotent)', () => {
    const canvas = makeNode('play', 'c', 0, 0, { effectId: 'canvas:x', canvasScene: 'x' });
    const typed = makeNode('play', 't', 0, 0, { effectId: 'plasma', playType: 'hits' });
    const out = inferPlayTypes(graphOf([canvas, typed]));
    expect(out.g!.nodes[0]!.playType).toBe('canvas');
    expect(out.g!.nodes[1]!.playType).toBe('hits'); // never overwritten

    // graphs whose play nodes all carry a type keep their reference (alias-stable)
    const again = inferPlayTypes(out);
    expect(again.g).toBe(out.g);
  });

  it('non-play nodes are untouched', () => {
    const trig = makeNode('trigger', 'tr', 0, 0);
    const out = inferPlayTypes(graphOf([trig]));
    expect(out.g!.nodes[0]!.playType).toBeUndefined();
  });
});
