import { describe, expect, it } from 'vitest';
import {
  inputMappingSchema,
  inputMappingSourceLabel,
  inputMappingTargetId,
  isContinuousTarget,
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
