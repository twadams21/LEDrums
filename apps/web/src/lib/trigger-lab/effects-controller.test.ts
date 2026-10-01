import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { MASTER_CELL, type EffectsAuthoringApi } from './effects-api';
import { createStandaloneEffectsApi } from './effects-controller.svelte';
import type { EffectsSection } from './effects-doc';

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
const kickCue: EffectCell = { row: 'kick', column: { kind: 'cue' } };
const kitAlways: EffectCell = { row: 'kit', column: { kind: 'always' } };

const fx = (id: string, cell: EffectCell, extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'solid' }, ...extra });

function demo(effects: effectChain.Effect[] = [fx('a', kickHead), fx('b', snareHead)]) {
  const section: EffectsSection = { effects, master: [] };
  return createStandaloneEffectsApi(section, kit);
}

describe('EffectsController (standalone host)', () => {
  it('satisfies the authoring contract', () => {
    const api: EffectsAuthoringApi = demo();
    expect(api.canEdit).toBe(true);
    expect(api.activeSectionId).toBe('section-demo');
  });

  it('exposes the grid read models from the kit and default input map', () => {
    const api = demo();
    expect(api.gridRows.map((r) => r.id)).toEqual(['kit', 'kick', 'snare']);
    expect(api.gridColumns.map((c) => c.label)).toEqual(['Center', 'Edge', 'Always', 'Clock', 'Cue']);
    expect(api.cellSummary(kickHead)).toMatchObject({ enabled: true, count: 1, firstName: 'a' });
    expect(api.cellEffects(kickHead).map((e) => e.id)).toEqual(['a']);
  });

  it('every mutator is one undo step; a no-op records nothing', () => {
    const api = demo();
    const id = api.addEffect(kickHead, 'wave', 'radial')!;
    expect(api.undoDepth).toBe(1);
    api.renameEffect(id, 'Pulse');
    api.setEffectOpacity(id, 0.5);
    const uid = api.addModifier(id, 'strobe')!;
    api.setModifierMix(id, uid, 0.4);
    expect(api.undoDepth).toBe(5);
    api.renameEffect(id, 'Pulse'); // unchanged
    api.removeEffect('no-such-effect');
    expect(api.undoDepth).toBe(5);

    api.undo();
    expect(api.effectById(id)!.modifiers[0]!.mix).toBe(1);
    api.undo();
    api.undo();
    api.undo();
    expect(api.effectById(id)!.name).toBe('Radial');
    api.undo();
    expect(api.effectById(id)).toBeUndefined();
  });

  it('a drag between beginGesture / endGesture folds into one undo step', () => {
    const api = demo();
    api.beginGesture();
    for (const v of [0.9, 0.7, 0.5, 0.3]) api.setEffectOpacity('a', v);
    api.endGesture();
    api.setEffectOpacity('a', 0.1);
    expect(api.undoDepth).toBe(2);
    api.undo();
    expect(api.effectById('a')!.opacity).toBe(0.3);
    api.undo();
    expect(api.effectById('a')!.opacity).toBe(1);
  });

  it('a viewer cannot edit: every mutator is a no-op, pastes and loads are refused', async () => {
    const api = demo();
    api.copyCell(kickHead);
    api.setCanEdit(false);
    const before = api.section;
    expect(api.canEdit).toBe(false);
    expect(api.addEffect(kickHead, 'solid')).toBeNull();
    api.removeEffect('a');
    api.renameEffect('a', 'nope');
    api.setGenerator('a', 'wave');
    expect(api.addModifier(MASTER_CELL, 'strobe')).toBeNull();
    expect(api.addControl('a', 'lfo')).toBeNull();
    api.clearCell(kickHead);
    api.beginGesture();
    api.setEffectOpacity('a', 0);
    api.endGesture();
    expect(api.pasteCell(snareHead).ok).toBe(false);
    expect(api.canPasteCell).toBe(false);
    expect((await api.loadFileIntoCell(kickHead)).ok).toBe(false);
    expect(api.section).toBe(before);
    expect(api.undoDepth).toBe(0);
    // audition still works for viewers
    api.fireEffect('a');
    expect(api.fired).toEqual(['effect:a']);
  });

  it('addEffect selects the new Effect and its cell; a disabled cell is refused', () => {
    const api = demo();
    const id = api.addEffect(snareHead, 'noise');
    expect(api.selectedEffectId).toBe(id);
    expect(api.selectedCell).toEqual(snareHead);
    expect(api.addEffect({ row: 'kick', column: { kind: 'zone', slot: 7 } }, 'solid')).toBeNull();
    expect(api.addEffect({ row: 'kit', column: { kind: 'zone', slot: 0 } }, 'solid')).toBeNull();
  });

  it('selectCell picks the bottom of the stack; Master selects no Effect; a removed selection reads as none', () => {
    const api = demo([fx('a', kickHead), fx('a2', kickHead)]);
    api.selectCell(kickHead);
    expect(api.selectedEffectId).toBe('a');
    api.selectCell(MASTER_CELL);
    expect(api.selectedCell).toBe(MASTER_CELL);
    expect(api.selectedEffectId).toBeNull();
    api.selectEffect('a2');
    api.removeEffect('a2');
    expect(api.selectedEffectId).toBeNull();
  });

  it('setTrigger moves the Effect to the matching column; back to zone lands in the row drum\'s first zone', () => {
    const api = demo();
    api.selectEffect('a');
    api.setTrigger('a', { kind: 'cue', source: { midiNote: 38 } });
    expect(api.effectById('a')!.cell).toEqual(kickCue);
    expect(api.selectedCell).toEqual(kickCue);
    api.setTrigger('a', { kind: 'zone' });
    expect(api.effectById('a')!.cell).toEqual(kickHead);
    const kitFx = api.addEffect(kitAlways, 'gradient')!;
    api.setTrigger(kitFx, { kind: 'zone' });
    expect(api.effectById(kitFx)!.cell).toEqual(kitAlways);
  });

  it('setGenerator keeps modifiers', () => {
    const api = demo();
    const uid = api.addModifier('a', 'strobe')!;
    api.setGenerator('a', 'wave', 'ripple');
    expect(api.effectById('a')!.generator).toMatchObject({ kind: 'wave', style: 'ripple' });
    expect(api.effectById('a')!.modifiers.map((m) => m.uid)).toEqual([uid]);
  });

  it('moveEffect moves between cells and a drag reorder is one undo', () => {
    const api = demo([fx('a', kickHead), fx('b', snareHead), fx('c', snareHead)]);
    api.moveEffect('a', snareHead, 1);
    expect(api.cellEffects(snareHead).map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(api.cellEffects(kickHead)).toEqual([]);
    expect(api.undoDepth).toBe(1);
  });

  it('copy / paste / clear cells', () => {
    const api = demo();
    expect(api.canPasteCell).toBe(false);
    expect(api.pasteCell(snareHead)).toEqual({ ok: false, reason: 'Nothing to paste.' });
    api.copyCell(kickHead);
    expect(api.canPasteCell).toBe(true);
    expect(api.pasteCell(snareHead)).toEqual({ ok: true });
    const snare = api.cellEffects(snareHead);
    expect(snare.map((e) => e.name)).toEqual(['b', 'a']);
    expect(snare[1]!.id).not.toBe('a');
    api.clearCell(snareHead);
    expect(api.cellSummary(snareHead).count).toBe(0);
    expect(api.undoDepth).toBe(2);
  });

  it('master chain edits address MASTER_CELL', () => {
    const api = demo();
    const uid = api.addModifier(MASTER_CELL, 'strobe')!;
    api.setModifierBypass(MASTER_CELL, uid, true);
    expect(api.masterChain).toMatchObject([{ uid, modifierId: 'strobe', bypass: true }]);
    api.removeModifier(MASTER_CELL, uid);
    expect(api.masterChain).toEqual([]);
  });

  it('controls and mappings round through the API', () => {
    const api = demo();
    const uid = api.addControl('a', 'cc')!;
    api.setControlSettings('a', uid, { controller: 74 });
    api.addMapping('a', uid, { device: 'effect', param: 'opacity', amount: 1, invert: true });
    api.setMapping('a', uid, 0, { amount: 0.5 });
    expect(api.effectById('a')!.controls).toEqual([
      { uid, kind: 'cc', settings: { controller: 74, channel: null }, mappings: [{ device: 'effect', param: 'opacity', amount: 0.5, invert: true }] },
    ]);
    api.removeMapping('a', uid, 0);
    api.removeControl('a', uid);
    expect(api.effectById('a')!.controls).toEqual([]);
  });

  it('fireEffectAt auditions the nth Effect in grid order; fires stamp fire times', () => {
    const api = demo([fx('snare', snareHead), fx('kitfx', kitAlways), fx('kick', kickHead)]);
    api.fireEffectAt(0);
    api.fireEffectAt(2);
    api.fireEffectAt(9); // past the end: nothing
    api.fireCell(kickHead);
    api.fireCell({ row: 'kick', column: { kind: 'clock' } }); // empty cell: nothing
    expect(api.fired).toEqual(['effect:kitfx', 'effect:snare', 'cell:kick/zone0']);
    expect(api.effectFireAt('kitfx')).toBeGreaterThan(0);
    expect(api.effectFireAt('kick')).toBe(0);
    expect(api.cellFireAt(kickHead)).toBeGreaterThan(0);
  });

  it('cue learn arms only a cue-triggered Effect', () => {
    const api = demo([fx('a', kickHead), fx('cue', kickCue)]);
    api.startCueLearn('a', 'midi');
    expect(api.cueLearnEffectId).toBeNull();
    api.startCueLearn('cue', 'osc');
    expect(api.cueLearnEffectId).toBe('cue');
    api.cancelCueLearn();
    expect(api.cueLearnEffectId).toBeNull();
  });

  it('files and legacy import are unavailable in the standalone host', async () => {
    const api = demo();
    expect(await api.loadFileIntoEffect('a')).toEqual({ ok: false, reason: 'Files are not available here.' });
    expect(await api.loadFileIntoEffect('zzz')).toEqual({ ok: false, reason: 'That Effect no longer exists.' });
    await expect(api.saveEffectToFile('a')).resolves.toBeUndefined();
    expect(api.legacyImportAvailable).toBe(false);
    expect(api.legacyShowNames).toEqual([]);
    expect(api.importLegacyShows().ok).toBe(false);
  });
});
