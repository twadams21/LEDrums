import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, effectChain, inputMapSchema, type KitConfig } from '@ledrums/core';
import { cellEnabled, cellSummary, effectsInGridOrder, gridColumns, gridRows, zoneSlotsForDrum } from './grid-model';

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick', color: '#ff0000' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: '', color: '#00ff00' },
  ],
};

const inputMap = inputMapSchema.parse({
  midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }],
  oscMap: [{ address: '/snare/rim', drumId: 'snare', slot: 2 }],
  zones: [
    { drumId: 'snare', slot: 0 },
    { drumId: 'kick', slot: 0, label: 'Beater' },
  ],
});

const fx = (id: string, cell: effectChain.EffectCell, extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'wave' }, ...extra });

describe('grid-model', () => {
  it('zoneSlotsForDrum unions declared and bound slots', () => {
    expect(zoneSlotsForDrum(inputMap, 'kick')).toEqual([0]);
    expect(zoneSlotsForDrum(inputMap, 'snare')).toEqual([0, 2]);
    expect(zoneSlotsForDrum(inputMap, 'tom')).toEqual([]);
  });

  it('gridRows is the Kit then drums in kit order', () => {
    expect(gridRows(kit)).toEqual([
      { id: 'kit', label: 'Kit' },
      { id: 'kick', label: 'Kick', color: '#ff0000' },
      { id: 'snare', label: 'snare', color: '#00ff00' },
    ]);
  });

  it('gridColumns is the zone-slot union then Always / Clock / Cue; disagreeing zone names fall back to "Zone N"', () => {
    expect(gridColumns(kit, inputMap)).toEqual([
      { column: { kind: 'zone', slot: 0 }, label: 'Zone 1' }, // kick "Beater" vs snare "Center"
      { column: { kind: 'zone', slot: 2 }, label: 'Rim-tip' },
      { column: { kind: 'always' }, label: 'Always' },
      { column: { kind: 'clock' }, label: 'Clock' },
      { column: { kind: 'cue' }, label: 'Cue' },
    ]);
  });

  it('cellEnabled: zones only on drums that have them, never on the Kit row; unknown rows are disabled', () => {
    expect(cellEnabled(kit, inputMap, { row: 'kick', column: { kind: 'zone', slot: 0 } })).toBe(true);
    expect(cellEnabled(kit, inputMap, { row: 'kick', column: { kind: 'zone', slot: 2 } })).toBe(false);
    expect(cellEnabled(kit, inputMap, { row: 'kit', column: { kind: 'zone', slot: 0 } })).toBe(false);
    expect(cellEnabled(kit, inputMap, { row: 'kit', column: { kind: 'always' } })).toBe(true);
    expect(cellEnabled(kit, inputMap, { row: 'tom', column: { kind: 'cue' } })).toBe(false);
  });

  it('cellSummary counts the stack, names the first Effect and flags an all-bypassed stack', () => {
    const cell = { row: 'snare', column: { kind: 'zone' as const, slot: 2 } };
    const section = { effects: [fx('a', cell, { bypass: true }), fx('b', cell, { bypass: true, generator: { kind: 'solid' } })], master: [] };
    expect(cellSummary(section, cell, kit, inputMap)).toEqual({
      enabled: true,
      count: 2,
      firstName: 'a',
      firstGenerator: 'wave',
      allBypassed: true,
      label: 'snare rim-tip',
    });
    expect(cellSummary(section, { row: 'kick', column: { kind: 'zone', slot: 0 } }, kit, inputMap)).toEqual({
      enabled: true,
      count: 0,
      allBypassed: false,
      label: 'Kick beater',
    });
    expect(cellSummary(null, { row: 'kit', column: { kind: 'clock' } }, kit, inputMap)).toMatchObject({ enabled: true, count: 0, label: 'Clock' });
    expect(cellSummary(null, { row: 'kit', column: { kind: 'zone', slot: 0 } }, kit, inputMap)).toMatchObject({ enabled: false, label: 'Zone 1' });
  });

  it('effectsInGridOrder walks rows then columns, each stack in order, off-grid Effects last', () => {
    const snareRim = { row: 'snare', column: { kind: 'zone' as const, slot: 2 } };
    const section = {
      effects: [
        fx('snare-rim', snareRim),
        fx('orphan', { row: 'gone', column: { kind: 'always' } }),
        fx('kit-cue', { row: 'kit', column: { kind: 'cue' } }),
        fx('kick-head', { row: 'kick', column: { kind: 'zone', slot: 0 } }),
        fx('kit-always', { row: 'kit', column: { kind: 'always' } }),
        fx('snare-rim-2', snareRim),
      ],
      master: [],
    };
    expect(effectsInGridOrder(section, gridRows(kit), gridColumns(kit, inputMap)).map((e) => e.id)).toEqual([
      'kit-always', 'kit-cue', 'kick-head', 'snare-rim', 'snare-rim-2', 'orphan',
    ]);
  });
});
