import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { MASTER_CELL } from './effects-api';
import { createStandaloneEffectsApi } from './effects-controller.svelte';
import type { EffectsSection } from './effects-doc';

/* The device strip's highlight and its keyboard edits (Tim, 2026-10-01: "highlight a plugin by
   clicking on it and pressing delete … cut, copy and paste with the usual key commands"), against
   the real in-memory authoring api: what each verb does to the section, where a paste lands, that
   every edit is one undo step, and what a viewer may do. */

type EffectCell = effectChain.EffectCell;

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' },
  ],
};
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const snareHead: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 0 } };

const fx = (id: string, cell: EffectCell, extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'solid' }, ...extra });

function demo(options: { canEdit?: boolean } = {}) {
  const a = fx('a', kickHead, {
    modifiers: [{ uid: 'm1', modifierId: 'strobe' }, { uid: 'm2', modifierId: 'strobe' }],
    controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'generator', param: 'hue' }, { device: 'm1', param: 'rate' }] }],
  });
  const b = fx('b', snareHead, { generator: { kind: 'wave', style: 'radial' } });
  const section: EffectsSection = { effects: [a, b], master: [] };
  return createStandaloneEffectsApi(section, kit, options);
}
const uids = (api: ReturnType<typeof demo>, id: string) => api.effectById(id)!.modifiers.map((m) => m.uid);

describe('selecting in the strip', () => {
  it('selecting a device selects its Effect and cell; a grid click clears the highlight', () => {
    const api = demo();
    api.selectDevice({ kind: 'modifier', owner: 'b', uid: 'x' }); // stale uid: reads as none
    expect(api.selectedDevice).toBeNull();
    api.selectDevice({ kind: 'control', effectId: 'a', uid: 'c1' });
    expect(api.selectedDevice).toEqual({ kind: 'control', effectId: 'a', uid: 'c1' });
    expect(api.selectedEffectId).toBe('a');
    expect(api.selectedCell).toEqual(kickHead);
    api.selectCell(snareHead);
    expect(api.selectedDevice).toBeNull();
  });
});

describe('Delete', () => {
  it('removes a highlighted Modifier — one undo step — and clears the highlight', () => {
    const api = demo();
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm1' });
    expect(api.editSelection('delete')).toEqual({ ok: true });
    expect(uids(api, 'a')).toEqual(['m2']);
    expect(api.effectById('a')!.controls[0]!.mappings.map((m) => m.device)).toEqual(['generator']); // its mapping went too
    expect(api.selectedDevice).toBeNull();
    expect(api.undoDepth).toBe(1);
    api.undo();
    expect(uids(api, 'a')).toEqual(['m1', 'm2']);
  });

  it('removes a highlighted Control, or the whole Effect when the Effect is highlighted', () => {
    const api = demo();
    api.selectDevice({ kind: 'control', effectId: 'a', uid: 'c1' });
    api.editSelection('delete');
    expect(api.effectById('a')!.controls).toEqual([]);
    api.selectDevice({ kind: 'effect', effectId: 'b' });
    api.editSelection('delete');
    expect(api.effectById('b')).toBeUndefined();
  });

  it('does nothing — and says so by returning null — with nothing highlighted', () => {
    expect(demo().editSelection('delete')).toBeNull();
  });
});

describe('cut, copy, paste', () => {
  it('copies a Modifier and pastes it right after the highlighted one, as a new device', () => {
    const api = demo();
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm1' });
    api.editSelection('copy');
    expect(api.undoDepth).toBe(0); // copying edits nothing
    expect(api.editSelection('paste')).toEqual({ ok: true });
    const chain = uids(api, 'a');
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe('m1');
    expect(chain[2]).toBe('m2');
    expect(api.selectedDevice).toEqual({ kind: 'modifier', owner: 'a', uid: chain[1] }); // the paste is highlighted
  });

  it('pastes a Modifier at the end of another Effect’s chain, and onto the Master chain', () => {
    const api = demo();
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm2' });
    api.editSelection('copy');
    api.selectDevice({ kind: 'effect', effectId: 'b' });
    api.editSelection('paste');
    expect(api.effectById('b')!.modifiers.map((m) => m.modifierId)).toEqual(['strobe']);
    api.selectCell(MASTER_CELL);
    api.editSelection('paste');
    expect(api.masterChain.map((m) => m.modifierId)).toEqual(['strobe']);
  });

  it('cut = copy + delete, and the cut thing pastes back', () => {
    const api = demo();
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm1' });
    api.editSelection('cut');
    expect(uids(api, 'a')).toEqual(['m2']);
    api.selectDevice({ kind: 'effect', effectId: 'b' });
    api.editSelection('paste');
    expect(api.effectById('b')!.modifiers).toHaveLength(1);
  });

  it('copies an Effect and pastes it into the selected cell', () => {
    const api = demo();
    api.selectDevice({ kind: 'effect', effectId: 'a' });
    api.editSelection('copy');
    api.selectCell(snareHead);
    expect(api.editSelection('paste')).toEqual({ ok: true });
    expect(api.cellEffects(snareHead).map((e) => e.name)).toEqual(['b', 'a']);
  });

  it('a pasted Control keeps only the mappings its new Effect can honour, and says how many it left off', () => {
    const api = demo();
    api.selectDevice({ kind: 'control', effectId: 'a', uid: 'c1' });
    api.editSelection('copy');
    api.selectDevice({ kind: 'effect', effectId: 'b' }); // a Wave Generator, no m1
    const result = api.editSelection('paste');
    expect(result).toMatchObject({ ok: true });
    expect(result && result.ok && result.note).toMatch(/2 of its mappings/);
    expect(api.effectById('b')!.controls[0]!.mappings).toEqual([]);
    // Back into its own Effect, both mappings still fit.
    api.selectDevice({ kind: 'effect', effectId: 'a' });
    expect(api.editSelection('paste')).toEqual({ ok: true });
    expect(api.effectById('a')!.controls[1]!.mappings).toHaveLength(2);
  });

  it('paste with an empty clipboard returns null; with nowhere to go it says where to click', () => {
    const api = demo();
    expect(api.editSelection('paste')).toBeNull();
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm1' });
    api.editSelection('copy');
    api.selectCell(null);
    expect(api.editSelection('paste')).toEqual({ ok: false, reason: 'Select an Effect to paste the Modifier into.' });
  });

  it('a viewer may copy but not cut, delete or paste', () => {
    const api = demo({ canEdit: false });
    api.selectDevice({ kind: 'modifier', owner: 'a', uid: 'm1' });
    expect(api.editSelection('copy')).toEqual({ ok: true });
    expect(api.editSelection('delete')).toMatchObject({ ok: false });
    expect(api.editSelection('cut')).toMatchObject({ ok: false });
    expect(api.editSelection('paste')).toMatchObject({ ok: false });
    expect(uids(api, 'a')).toEqual(['m1', 'm2']);
  });
});
