import { describe, expect, it } from 'vitest';
import {
  inputMappingSchema,
  inputMappingSourceLabel,
  inputMappingTargetId,
  isContinuousTarget,
  matchInputMapping,
  parseInputMappings,
  scaleInputMappingValue,
  type InputMapping,
} from './input-mappings';

describe('InputMapping contract', () => {
  it('accepts exactly one source kind', () => {
    const base = { id: 'm1', target: { kind: 'fireEffect', effectId: 'fx-1' } };
    expect(inputMappingSchema.safeParse({ ...base, source: { midiNote: 60 } }).success).toBe(true);
    expect(inputMappingSchema.safeParse({ ...base, source: { key: 'KeyQ' } }).success).toBe(true);
    expect(inputMappingSchema.safeParse({ ...base, source: { midiNote: 60, midiCc: 1 } }).success).toBe(false);
    expect(inputMappingSchema.safeParse({ ...base, source: {} }).success).toBe(false);
  });

  it('gives one stable id per target', () => {
    const cell = { kind: 'fireCell', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } } as const;
    expect(inputMappingTargetId(cell)).toBe('fireCell:kick:zone0');
    expect(inputMappingTargetId({ kind: 'bypass', effectId: 'fx-1' })).not.toBe(
      inputMappingTargetId({ kind: 'bypass', effectId: 'fx-1', modifierUid: 'mod-1' }),
    );
    expect(inputMappingTargetId({ kind: 'param', effectId: 'fx-1', device: 'generator', param: 'speed' })).toBe(
      'param:fx-1:generator:speed',
    );
  });

  it('classifies continuous targets', () => {
    expect(isContinuousTarget({ kind: 'opacity', effectId: 'fx-1' })).toBe(true);
    expect(isContinuousTarget({ kind: 'fireEffect', effectId: 'fx-1' })).toBe(false);
  });

  it('labels sources for badges', () => {
    expect(inputMappingSourceLabel({ midiNote: 60 })).toBe('Note 60');
    expect(inputMappingSourceLabel({ midiCc: 21 })).toBe('CC 21');
    expect(inputMappingSourceLabel({ oscAddress: '/osc/x' })).toBe('/osc/x');
    expect(inputMappingSourceLabel({ key: 'KeyQ' })).toBe('Key Q');
  });
});

describe('matchInputMapping', () => {
  const m = (id: string, source: InputMapping['source']): InputMapping =>
    ({ id, source, target: { kind: 'fireEffect', effectId: id } });
  const mappings = [m('note', { midiNote: 36 }), m('cc', { midiCc: 36 }), m('osc', { oscAddress: '/a' }), m('key', { key: 'KeyQ' })];

  it('matches on the source kind only — note 36 and CC 36 are different sources', () => {
    expect(matchInputMapping(mappings, { midiNote: 36 })?.id).toBe('note');
    expect(matchInputMapping(mappings, { midiCc: 36 })?.id).toBe('cc');
    expect(matchInputMapping(mappings, { oscAddress: '/a' })?.id).toBe('osc');
    expect(matchInputMapping(mappings, { key: 'KeyQ' })?.id).toBe('key');
  });

  it('returns null for an unmapped input, and the first match on a (guard-refused) tie', () => {
    expect(matchInputMapping(mappings, { midiNote: 37 })).toBeNull();
    expect(matchInputMapping(mappings, { oscAddress: '/b' })).toBeNull();
    expect(matchInputMapping([m('first', { midiNote: 1 }), m('second', { midiNote: 1 })], { midiNote: 1 })?.id).toBe('first');
  });
});

describe('scaleInputMappingValue', () => {
  it('maps 0..1 onto the range, reversed ranges included, clamped to the target bounds', () => {
    expect(scaleInputMappingValue(0.5, 0, 10, 0, 10)).toBe(5);
    expect(scaleInputMappingValue(0, 0.8, 0.2, 0, 1)).toBeCloseTo(0.8);
    expect(scaleInputMappingValue(1, 0.8, 0.2, 0, 1)).toBeCloseTo(0.2);
    expect(scaleInputMappingValue(1, 0, 5, 0, 2)).toBe(2);
    expect(scaleInputMappingValue(2, 0, 1, 0, 1)).toBe(1);
  });

  it('reads a non-finite input as 0', () => {
    expect(scaleInputMappingValue(Number.NaN, 0.3, 0.9, 0, 1)).toBeCloseTo(0.3);
  });
});

describe('parseInputMappings', () => {
  it('keeps valid entries in order and reports each invalid or duplicate-id one by index', () => {
    const ok = { id: 'a', source: { midiNote: 1 }, target: { kind: 'opacity', effectId: 'fx' } };
    const { mappings, dropped } = parseInputMappings([ok, { id: 'b', source: {}, target: ok.target }, { ...ok }, 'junk']);
    expect(mappings.map((x) => x.id)).toEqual(['a']);
    expect(dropped.map((d) => [d.index, d.id])).toEqual([[1, 'b'], [2, 'a'], [3, undefined]]);
  });

  it('reads absent as none and a non-array as one dropped field', () => {
    expect(parseInputMappings(undefined)).toEqual({ mappings: [], dropped: [] });
    expect(parseInputMappings({}).dropped).toEqual([{ index: -1, message: 'mappings is not an array' }]);
  });
});
