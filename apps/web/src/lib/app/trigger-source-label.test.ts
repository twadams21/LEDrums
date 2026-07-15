import { describe, expect, it } from 'vitest';
import { describeTriggerSource, drumLinkHint, graphsLinkedToZone, zoneLabel, zoneLinkForSource } from './trigger-source-label';
import { makeNode, type TriggerGraph, type TriggerSource } from '../trigger-lab/sim';
import type { InputMap } from '@ledrums/core';

/** A small drum roster (id → label) — the shape of store.drums. */
const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
];

describe('zoneLabel', () => {
  it('maps the numeric zone index to its hoop label', () => {
    expect(zoneLabel('0')).toBe('center');
    expect(zoneLabel('1')).toBe('edge');
    expect(zoneLabel('2')).toBe('rim');
    expect(zoneLabel('3')).toBe('shell');
  });

  it('falls back to the raw value for an out-of-range or non-numeric zone', () => {
    expect(zoneLabel('9')).toBe('9');
    expect(zoneLabel('foo')).toBe('foo');
    expect(zoneLabel('')).toBe('');
  });
});

describe('describeTriggerSource', () => {
  it('describes a drum source as "Drum" + drum · zone, resolving the label from drums', () => {
    const src: TriggerSource = { kind: 'drum', drumId: 'kick', zone: '0' };
    expect(describeTriggerSource(src, DRUMS)).toEqual({ label: 'Drum', sub: 'Kick · center' });
  });

  it('falls back to the raw drum id when it is not in the roster', () => {
    const src: TriggerSource = { kind: 'drum', drumId: 'ghost', zone: '2' };
    expect(describeTriggerSource(src, DRUMS)).toEqual({ label: 'Drum', sub: 'ghost · rim' });
  });

  it('handles zone index 0 (a falsy-looking but valid zone)', () => {
    expect(describeTriggerSource({ kind: 'drum', drumId: 'snare', zone: '0' }, DRUMS).sub).toBe('Snare · center');
  });

  it('describes a MIDI note source', () => {
    expect(describeTriggerSource({ kind: 'midi', note: 38 }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI D2' });
  });

  it('describes a MIDI CC source (CC takes precedence over note)', () => {
    expect(describeTriggerSource({ kind: 'midi', cc: 74 }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI CC 74' });
    expect(describeTriggerSource({ kind: 'midi', note: 1, cc: 74 }, DRUMS).sub).toBe('MIDI CC 74');
  });

  it('handles a MIDI source with neither note nor CC set', () => {
    expect(describeTriggerSource({ kind: 'midi' }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI — set a note' });
  });

  it('describes an OSC source', () => {
    expect(describeTriggerSource({ kind: 'osc', address: '/kick' }, DRUMS)).toEqual({ label: 'OSC', sub: 'OSC /kick' });
  });

  it('handles an OSC source with an empty / whitespace address', () => {
    expect(describeTriggerSource({ kind: 'osc', address: '  ' }, DRUMS)).toEqual({ label: 'OSC', sub: 'OSC — set an address' });
  });

  it('shows an unbound placeholder when the source is unset (authored graph)', () => {
    expect(describeTriggerSource(undefined, DRUMS)).toEqual({ label: 'Trigger', sub: 'unbound' });
  });
});

/** An input map mapping note 38 → snare · center (slot 0) and OSC /kick → kick · center. */
const MAP: InputMap = {
  midiChannel: null,
  zones: [],
  midiNotes: [{ note: 38, drumId: 'snare', slot: 0 }],
  oscMap: [{ address: '/kick', drumId: 'kick', slot: 0 }],
};

/** A one-node trigger graph carrying a source (enough for the reverse resolver). */
function graph(source: TriggerSource | undefined): TriggerGraph {
  return { nodes: [makeNode('trigger', 'trigger', 0, 0, { source })], edges: [] };
}

describe('zoneLinkForSource', () => {
  it('links a MIDI note source that is also a mapped zone', () => {
    expect(zoneLinkForSource(MAP, { kind: 'midi', note: 38 })).toEqual({ drumId: 'snare', zone: '0' });
  });

  it('links an OSC source that is also a mapped zone', () => {
    expect(zoneLinkForSource(MAP, { kind: 'osc', address: '/kick' })).toEqual({ drumId: 'kick', zone: '0' });
    // trims before matching
    expect(zoneLinkForSource(MAP, { kind: 'osc', address: ' /kick ' })).toEqual({ drumId: 'kick', zone: '0' });
  });

  it('returns null for a note/address that is not zone-mapped', () => {
    expect(zoneLinkForSource(MAP, { kind: 'midi', note: 60 })).toBeNull();
    expect(zoneLinkForSource(MAP, { kind: 'osc', address: '/snare' })).toBeNull();
  });

  it('returns null for a drum source (it IS the drum trigger, no extra link)', () => {
    expect(zoneLinkForSource(MAP, { kind: 'drum', drumId: 'snare', zone: '0' })).toBeNull();
  });

  it('returns null for a CC source (the zone-map keys notes, not CCs) and an unbound source', () => {
    expect(zoneLinkForSource(MAP, { kind: 'midi', cc: 38 })).toBeNull();
    expect(zoneLinkForSource(MAP, { kind: 'midi', note: 38, cc: 74 })).toBeNull(); // cc wins
    expect(zoneLinkForSource(MAP, { kind: 'midi' })).toBeNull();
    expect(zoneLinkForSource(MAP, undefined)).toBeNull();
    expect(zoneLinkForSource(MAP, { kind: 'osc', address: ' ' })).toBeNull();
  });
});

describe('drumLinkHint', () => {
  it('names the zone-mapped drum, resolving the label from drums', () => {
    expect(drumLinkHint(MAP, { kind: 'midi', note: 38 }, DRUMS)).toBe('also drum trigger: Snare · center');
    expect(drumLinkHint(MAP, { kind: 'osc', address: '/kick' }, DRUMS)).toBe('also drum trigger: Kick · center');
  });

  it('is null when the source is not zone-mapped', () => {
    expect(drumLinkHint(MAP, { kind: 'midi', note: 60 }, DRUMS)).toBeNull();
    expect(drumLinkHint(MAP, { kind: 'drum', drumId: 'kick', zone: '0' }, DRUMS)).toBeNull();
    expect(drumLinkHint(MAP, undefined, DRUMS)).toBeNull();
  });
});

describe('graphsLinkedToZone', () => {
  const graphs: Record<string, TriggerGraph> = {
    'g:note': graph({ kind: 'midi', note: 38 }),
    'g:osc': graph({ kind: 'osc', address: '/kick' }),
    'g:other': graph({ kind: 'midi', note: 60 }),
    'g:cc': graph({ kind: 'midi', cc: 38 }),
    'g:drum': graph({ kind: 'drum', drumId: 'snare', zone: '0' }),
    'g:unbound': graph(undefined),
  };

  it('finds the graphs whose source note matches the zone note', () => {
    expect(graphsLinkedToZone(graphs, 38, null)).toEqual(['g:note']);
  });

  it('finds the graphs whose source address matches the zone address (trimmed)', () => {
    expect(graphsLinkedToZone(graphs, null, '/kick')).toEqual(['g:osc']);
    expect(graphsLinkedToZone(graphs, null, ' /kick ')).toEqual(['g:osc']);
  });

  it('matches both a note and an address at once, ignoring CC / drum / unbound sources', () => {
    expect(graphsLinkedToZone(graphs, 38, '/kick').sort()).toEqual(['g:note', 'g:osc']);
  });

  it('returns nothing for an unmapped zone (no note, no address, or no match)', () => {
    expect(graphsLinkedToZone(graphs, null, null)).toEqual([]);
    expect(graphsLinkedToZone(graphs, 99, '/nope')).toEqual([]);
    expect(graphsLinkedToZone(graphs, null, '  ')).toEqual([]);
  });
});
