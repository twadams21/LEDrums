import { describe, expect, it } from 'vitest';
import { applySequenceResets, isResetStateKey, resetSourceMatches, resolveSequenceResets } from './reset-source';
import type { GraphNode, TriggerGraph } from './types';

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5,
    invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

function graph(nodes: GraphNode[]): TriggerGraph {
  return { version: 3, nodes, edges: [] };
}

describe('resetSourceMatches', () => {
  it('drum: matches on drumId + zone, with zone defaulting to the empty string', () => {
    const src = { kind: 'drum', drumId: 'kick', zone: '' } as const;
    expect(resetSourceMatches(src, { drumId: 'kick', zone: '' })).toBe(true);
    expect(resetSourceMatches(src, { drumId: 'kick' })).toBe(true); // absent zone = ''
    expect(resetSourceMatches(src, { drumId: 'kick', zone: 'rim' })).toBe(false);
    expect(resetSourceMatches(src, { drumId: 'snare', zone: '' })).toBe(false);
    expect(resetSourceMatches(src, { note: 60 })).toBe(false); // no drumId on the input
  });

  it('midi: matches on note; an unset note binding matches nothing', () => {
    expect(resetSourceMatches({ kind: 'midi', note: 61 }, { note: 61 })).toBe(true);
    expect(resetSourceMatches({ kind: 'midi', note: 61 }, { note: 62 })).toBe(false);
    expect(resetSourceMatches({ kind: 'midi' }, { note: 61 })).toBe(false);
    expect(resetSourceMatches({ kind: 'midi', note: 61 }, { drumId: 'kick' })).toBe(false);
  });

  it('a zone-mapped MIDI hit (drumId AND note) reaches both binding kinds', () => {
    const input = { drumId: 'kick', zone: '', note: 61 };
    expect(resetSourceMatches({ kind: 'drum', drumId: 'kick', zone: '' }, input)).toBe(true);
    expect(resetSourceMatches({ kind: 'midi', note: 61 }, input)).toBe(true);
  });

  it('osc: matches on exact address', () => {
    expect(resetSourceMatches({ kind: 'osc', address: '/reset' }, { address: '/reset' })).toBe(true);
    expect(resetSourceMatches({ kind: 'osc', address: '/reset' }, { address: '/reset2' })).toBe(false);
    expect(resetSourceMatches({ kind: 'osc', address: '/reset' }, { note: 61 })).toBe(false);
  });
});

describe('resolveSequenceResets', () => {
  it('finds bound sequence nodes across graphs; ignores unbound sequences and other kinds', () => {
    const graphs = {
      a: graph([
        node('sequence', 'seq1', { resetSource: { kind: 'midi', note: 61 } }),
        node('sequence', 'seq2'), // unbound — never matches
      ]),
      b: graph([
        node('sequence', 'seq3', { resetSource: { kind: 'midi', note: 61 } }),
        // a non-sequence node carrying the field is ignored: reset lives on sequence only
        node('all', 'x', { resetSource: { kind: 'midi', note: 61 } }),
      ]),
      c: graph([node('sequence', 'seq4', { resetSource: { kind: 'midi', note: 99 } })]),
    };
    expect(resolveSequenceResets(graphs, { note: 61 })).toEqual([
      { graphKey: 'a', nodeId: 'seq1' },
      { graphKey: 'b', nodeId: 'seq3' },
    ]);
  });

  it('returns empty for an input matching nothing', () => {
    const graphs = { a: graph([node('sequence', 'seq1', { resetSource: { kind: 'osc', address: '/r' } })]) };
    expect(resolveSequenceResets(graphs, { note: 61 })).toEqual([]);
  });
});

describe('isResetStateKey', () => {
  it('claims the bare-key and slot-index prefixes of its own node', () => {
    expect(isResetStateKey('kick:0#seq', 'kick:0', 'seq')).toBe(true); // pad fallback / direct
    expect(isResetStateKey('kick:0#2#seq', 'kick:0', 'seq')).toBe(true); // section slot 2
  });

  it('rejects other nodes, other graphs, and non-digit middles', () => {
    expect(isResetStateKey('kick:0#other', 'kick:0', 'seq')).toBe(false);
    expect(isResetStateKey('snare:0#seq', 'kick:0', 'seq')).toBe(false);
    expect(isResetStateKey('kick:0#x#seq', 'kick:0', 'seq')).toBe(false);
  });

  it('graph `kick` can never claim graph `kick:0`’s keys', () => {
    expect(isResetStateKey('kick:0#seq', 'kick', 'seq')).toBe(false);
    expect(isResetStateKey('kick#0#seq', 'kick', 'seq')).toBe(true); // kick's own slot 0
  });
});

describe('applySequenceResets', () => {
  it('clears every prefix of each matched node and nothing else', () => {
    const graphs = { g: graph([node('sequence', 'seq', { resetSource: { kind: 'midi', note: 61 } })]) };
    const seqIndex = new Map([
      ['g#seq', 2], //     pad fallback / direct prefix
      ['g#0#seq', 1], //   section slot 0
      ['g#1#seq', 3], //   section slot 1
      ['g#other', 4], //   another node in the same graph
      ['h#seq', 5], //     same node id, different graph
    ]);
    const hits = applySequenceResets(seqIndex, graphs, { note: 61 });
    expect(hits).toEqual([{ graphKey: 'g', nodeId: 'seq' }]);
    expect([...seqIndex.keys()].sort()).toEqual(['g#other', 'h#seq']);
  });

  it('is a silent no-op when nothing matches', () => {
    const graphs = { g: graph([node('sequence', 'seq', { resetSource: { kind: 'midi', note: 61 } })]) };
    const seqIndex = new Map([['g#seq', 2]]);
    expect(applySequenceResets(seqIndex, graphs, { note: 99 })).toEqual([]);
    expect(seqIndex.size).toBe(1);
  });
});
