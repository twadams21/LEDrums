import { describe, expect, it } from 'vitest';
import type { effectChain } from '@ledrums/core';
import {
  BypassToggleEdges,
  globalControlPatch,
  globalControlSource,
  mapSourceKindRefusal,
  mapTargetId,
  withMappingRange,
  withMappingSource,
  withoutMapping,
} from './input-mappings';

type InputMapping = effectChain.InputMapping;
type InputMappingTarget = effectChain.InputMappingTarget;

const CELL: InputMappingTarget = { kind: 'fireCell', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } };
const FADER: InputMappingTarget = { kind: 'opacity', effectId: 'fx-1' };
const ids = (): (() => string) => {
  let n = 0;
  return () => `map-${++n}`;
};

describe('withMappingSource', () => {
  it('appends a new mapping for an unbound target', () => {
    const next = withMappingSource([], CELL, { midiNote: 60 }, ids());
    expect(next).toEqual([{ id: 'map-1', source: { midiNote: 60 }, target: CELL }]);
  });

  it('re-binding keeps the id and range and replaces the source', () => {
    const start: InputMapping[] = [{ id: 'm', source: { midiCc: 21 }, target: FADER, rangeMin: 0.2 }];
    expect(withMappingSource(start, FADER, { midiCc: 22 }, ids())).toEqual([{ id: 'm', source: { midiCc: 22 }, target: FADER, rangeMin: 0.2 }]);
  });

  it('re-learning the same source returns the same array (no edit)', () => {
    const start: InputMapping[] = [{ id: 'm', source: { oscAddress: '/a' }, target: CELL }];
    expect(withMappingSource(start, CELL, { oscAddress: '/a' }, ids())).toBe(start);
  });
});

describe('withoutMapping / withMappingRange', () => {
  const start: InputMapping[] = [
    { id: 'a', source: { midiNote: 60 }, target: CELL },
    { id: 'b', source: { midiCc: 21 }, target: FADER },
  ];

  it('removes only the target’s mapping; an unbound target is the same array', () => {
    expect(withoutMapping(start, mapTargetId(CELL)).map((m) => m.id)).toEqual(['b']);
    expect(withoutMapping(start, 'opacity:other')).toBe(start);
  });

  it('sets and unsets a continuous range; a discrete target or no change is the same array', () => {
    const ranged = withMappingRange(start, mapTargetId(FADER), 0.1, 0.9);
    expect(ranged[1]).toEqual({ id: 'b', source: { midiCc: 21 }, target: FADER, rangeMin: 0.1, rangeMax: 0.9 });
    expect(withMappingRange(ranged, mapTargetId(FADER), 0.1, 0.9)).toBe(ranged);
    const unset = withMappingRange(ranged, mapTargetId(FADER), undefined, Number.NaN);
    expect(unset[1]).toEqual({ id: 'b', source: { midiCc: 21 }, target: FADER });
    expect(withMappingRange(start, mapTargetId(CELL), 0, 1)).toBe(start);
  });
});

describe('source kinds and global controls', () => {
  it('a key cannot bind a continuous target or a global control; everything else can', () => {
    expect(mapSourceKindRefusal(FADER, { key: 'KeyQ' })).toMatch(/continuous/);
    expect(mapSourceKindRefusal({ kind: 'globalControl', action: 'nextSection' }, { key: 'KeyQ' })).toMatch(/not a key/);
    expect(mapSourceKindRefusal(CELL, { key: 'KeyQ' })).toBeNull();
    expect(mapSourceKindRefusal(FADER, { midiCc: 21 })).toBeNull();
    expect(mapSourceKindRefusal({ kind: 'globalControl', action: 'nextSection' }, { midiNote: 60 })).toBeNull();
  });

  it('a global control reads as one source (note, then CC, then OSC) and patches only its own field', () => {
    expect(globalControlSource(undefined)).toBeNull();
    expect(globalControlSource({ oscAddress: ' /next ', midiCc: 5 })).toEqual({ midiCc: 5 });
    expect(globalControlSource({ oscAddress: ' /next ' })).toEqual({ oscAddress: '/next' });
    expect(globalControlPatch({ midiNote: 60 })).toEqual({ midiNote: 60 });
    expect(globalControlPatch({ oscAddress: ' /x ' })).toEqual({ oscAddress: '/x' });
    expect(globalControlPatch({ key: 'KeyQ' })).toBeNull();
  });
});

describe('BypassToggleEdges', () => {
  it('a CC presses once per rising edge through 0.5 (a 127 / 0 button, or a knob sweep)', () => {
    const edges = new BypassToggleEdges();
    const sweep = [0.1, 0.4, 0.6, 0.8, 1, 0.7, 0.2, 0.9];
    expect(sweep.map((v) => edges.cc(21, v))).toEqual([false, false, true, false, false, false, false, true]);
    expect(edges.cc(22, 1)).toBe(true); // per controller
    edges.reset();
    expect(edges.cc(21, 1)).toBe(true);
  });

  it('an OSC message presses at or above 0.5 (its 0 release does not)', () => {
    const edges = new BypassToggleEdges();
    expect([1, 0, 1, 0.5, 0.49].map((v) => edges.osc(v))).toEqual([true, false, true, true, false]);
  });
});
