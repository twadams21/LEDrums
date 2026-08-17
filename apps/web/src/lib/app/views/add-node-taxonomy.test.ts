import { describe, expect, it } from 'vitest';
import { ADD_NODE_TYPES, decodeAddDragPayload, encodeAddDragPayload, isAddNodeKind } from './add-node-taxonomy';
import { kindLabel, kindIcon, tint } from './trigger-node-meta';

describe('ADD_NODE_TYPES', () => {
  it('is the flat list of node types Trent fixed, in order', () => {
    expect(ADD_NODE_TYPES.map((t) => t.label)).toEqual([
      'Effect',
      'All',
      'Random',
      'Sequence',
      'Switch',
      'Chance',
      'Toggle',
      'Delay',
      'Modifier',
      'Mix',
      'Scope',
      'Modulate',
    ]);
  });

  it('adds one node per row — no subtype ids, no second click', () => {
    expect(ADD_NODE_TYPES.map((t) => t.kind)).toEqual([
      'effect',
      'all',
      'random',
      'sequence',
      'switch',
      'chance',
      'toggle',
      'delay',
      'modifier',
      'mix',
      'scope',
      'envelope',
    ]);
  });

  it('reads its icons and colours from the node registry rather than redrawing them', () => {
    for (const t of ADD_NODE_TYPES.filter((r) => r.label !== 'Modulate')) {
      expect(t.label).toBe(kindLabel[t.kind]);
      expect(t.icon).toBe(kindIcon[t.kind]);
      expect(t.tint).toBe(tint[t.kind]);
    }
    // Modulate is the one family label: the row's colour still comes from the kind it adds.
    const modulate = ADD_NODE_TYPES.at(-1)!;
    expect(modulate.tint).toBe(tint.envelope);
  });

  it('gives every row a qualifier', () => {
    expect(ADD_NODE_TYPES.every((t) => t.hint.length > 0)).toBe(true);
  });
});

describe('drag payload', () => {
  it('round-trips an addable kind', () => {
    expect(decodeAddDragPayload(encodeAddDragPayload('scope'))).toBe('scope');
  });

  it('refuses anything that is not an addable kind', () => {
    expect(decodeAddDragPayload('')).toBeNull();
    expect(decodeAddDragPayload('trigger')).toBeNull(); // anchors are never added
    expect(decodeAddDragPayload('output')).toBeNull();
    expect(decodeAddDragPayload('{"id":"switch"}')).toBeNull();
  });

  it('guards on the same list the palette renders', () => {
    expect(isAddNodeKind('mix')).toBe(true);
    expect(isAddNodeKind('lfo')).toBe(false); // reached by re-typing an Envelope, not by adding
  });
});
