import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
import {
  sectionCellSummaries,
  sectionEffectCount,
  sectionMasterSummary,
  songEffectCount,
} from './section-effects';

/* The Sections view reads NON-active sections directly (the api only exposes the active one), so
   these summaries must group any section's Effects by cell in the grid's order and label them
   with the grid's own row / column labels. Rows and columns come from a real standalone api. */

type EffectCell = effectChain.EffectCell;

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick', color: '#ff0000' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare', color: '#00ff00' },
  ],
};
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const snareEdge: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 1 } };
const kitAlways: EffectCell = { row: 'kit', column: { kind: 'always' } };
const goneDrum: EffectCell = { row: 'floor-tom', column: { kind: 'cue' } };

const fx = (id: string, cell: EffectCell, extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id, name: `FX ${id}`, cell, generator: { kind: 'solid' }, ...extra });

const api = createStandaloneEffectsApi({ effects: [], master: [] }, kit);

describe('sectionCellSummaries', () => {
  it('groups Effects by cell in grid order (rows, then columns), names in stack order', () => {
    const section = {
      effects: [fx('s1', snareEdge), fx('k1', kickHead), fx('a1', kitAlways), fx('k2', kickHead)],
      master: [],
    };
    const rows = sectionCellSummaries(section, api.gridRows, api.gridColumns);
    expect(rows.map((r) => [r.rowLabel, r.columnLabel, r.names])).toEqual([
      ['Kit', 'Always', ['FX a1']],
      ['Kick', 'Center', ['FX k1', 'FX k2']],
      ['Snare', 'Edge', ['FX s1']],
    ]);
    expect(rows[1]!.color).toBe('#ff0000');
    expect(rows[0]!.color).toBeUndefined();
    expect(rows[1]!.cell).toEqual(kickHead);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it('marks a cell bypassed only when every Effect in it is', () => {
    const section = {
      effects: [fx('k1', kickHead, { bypass: true }), fx('k2', kickHead), fx('s1', snareEdge, { bypass: true })],
      master: [],
    };
    const rows = sectionCellSummaries(section, api.gridRows, api.gridColumns);
    expect(rows.map((r) => r.allBypassed)).toEqual([false, true]);
  });

  it('keeps Effects in cells the grid no longer shows, labelled from the raw cell', () => {
    const section = { effects: [fx('x', goneDrum), fx('k1', kickHead)], master: [] };
    const rows = sectionCellSummaries(section, api.gridRows, api.gridColumns);
    expect(rows.map((r) => `${r.rowLabel}/${r.columnLabel}`)).toEqual(['Kick/Center', 'floor-tom/Cue']);
  });

  it('reads a graph-shaped section (no effects field) as an empty grid', () => {
    const graphSection = { id: 's', name: 'Verse', graphs: ['g1'], looks: {} };
    expect(sectionCellSummaries(graphSection, api.gridRows, api.gridColumns)).toEqual([]);
    expect(sectionEffectCount(graphSection)).toBe(0);
    expect(sectionMasterSummary(graphSection)).toBeNull();
  });
});

describe('sectionMasterSummary', () => {
  it('names the master modifiers and flags an all-bypassed chain', () => {
    const master = [
      { uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: true },
      { uid: 'm2', modifierId: 'no-such-modifier', params: {}, mix: 1, bypass: true },
    ];
    const summary = sectionMasterSummary({ effects: [], master });
    expect(summary!.names[1]).toBe('no-such-modifier');
    expect(summary!.names[0]).not.toBe('strobe'); // the registry's display name, not the id
    expect(summary!.allBypassed).toBe(true);
    expect(sectionMasterSummary({ effects: [], master: [] })).toBeNull();
  });
});

describe('Effect counts', () => {
  it('counts a section stack and totals a song', () => {
    const a = { effects: [fx('1', kickHead), fx('2', kickHead)], master: [] };
    const b = { effects: [fx('3', kitAlways)], master: [] };
    expect(sectionEffectCount(a)).toBe(2);
    expect(songEffectCount({ sections: [a, b, { graphs: [] }] })).toBe(3);
  });
});
