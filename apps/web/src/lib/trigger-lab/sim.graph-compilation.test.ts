import { describe, expect, it } from 'vitest';
import { treeToGraph, type Block } from './sim';

function play(id: string): Block {
  return {
    kind: 'play',
    id,
    mode: 'oneshot',
    scope: 'kit',
    effectId: 'gen:chase-bands',
    presetId: 'chase:default',
    params: {},
    env: {},
  };
}

describe('treeToGraph Gen3 compilation', () => {
  it('canonicalizes legacy play blocks to effect nodes and gates them through Output', () => {
    const graph = treeToGraph(play('p1'));

    expect(graph.version).toBe(3);
    expect(graph.nodes.find((n) => n.id === 'p1')).toMatchObject({ kind: 'effect' });
    expect(graph.nodes.some((n) => n.kind === 'play')).toBe(false);
    expect(graph.nodes.find((n) => n.id === 'output')).toMatchObject({ kind: 'output', scope: 'kit' });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'trigger', to: 'p1' }),
        expect.objectContaining({ from: 'p1', to: 'output' }),
      ]),
    );
  });

  it('preserves value-band handles while adding Output terminal wiring', () => {
    const graph = treeToGraph({
      kind: 'switch',
      id: 'sw',
      on: 'value',
      valueMode: 'bands',
      bands: [0.5],
      children: [play('low'), play('high')],
    });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'sw', to: 'low', fromPort: 'band-0' }),
        expect.objectContaining({ from: 'sw', to: 'high', fromPort: 'band-1' }),
        expect.objectContaining({ from: 'low', to: 'output' }),
        expect.objectContaining({ from: 'high', to: 'output' }),
      ]),
    );
  });
});
