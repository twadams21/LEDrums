import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from './effects-controller.svelte';
import * as doc from './effects-doc';
import type { EffectsSection } from './effects-doc';
import { coerceAuthoredV3 } from './persistence';

/* Cell play on the authoring side (Tim, 2026-10-01): the document ops, the api against the real
   in-memory host (one undo step each, Learn arming, the "played last" step the UI marks), and that
   a saved show keeps it. The step logic itself is pinned in core (cell-play / engine tests). */

type EffectCell = effectChain.EffectCell;
const kit: KitConfig = { ...DEFAULT_KIT, drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }] };
const KICK: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const ALWAYS: EffectCell = { row: 'kit', column: { kind: 'always' } };
const fx = (id: string, extra: Record<string, unknown> = {}) => effectChain.parseEffect({ id, name: id, cell: KICK, generator: { kind: 'solid' }, ...extra });

function demo() {
  const section: EffectsSection = { effects: [fx('a'), fx('b'), fx('c')], master: [] };
  return createStandaloneEffectsApi(section, kit);
}

describe('document ops', () => {
  const base: EffectsSection = { effects: [fx('a'), fx('b')], master: [] };

  it('setCellPlayMode adds, switches (keeping the reset) and removes on Layer', () => {
    let s = doc.setCellPlayMode(base, KICK, 'sequence');
    expect(s.cellPlay).toEqual([{ cell: KICK, mode: 'sequence' }]);
    s = doc.setCellReset(s, KICK, { kind: 'midiNote', note: 30 });
    s = doc.setCellPlayMode(s, KICK, 'random');
    expect(s.cellPlay).toEqual([{ cell: KICK, mode: 'random', reset: { kind: 'midiNote', note: 30 } }]);
    expect(doc.setCellPlayMode(s, KICK, 'layer').cellPlay).toEqual([]);
  });

  it('refuses an Always cell, and a reset on a layering cell', () => {
    expect(doc.setCellPlayMode(base, ALWAYS, 'sequence')).toBe(base);
    expect(doc.setCellReset(base, KICK, { kind: 'midiNote', note: 30 })).toBe(base);
  });

  it('clearing a cell sends it back to Layer', () => {
    const s = doc.setCellPlayMode(base, KICK, 'sequence');
    expect(doc.clearCell(s, KICK).cellPlay).toEqual([]);
  });
});

describe('the authoring api', () => {
  it('sets the mode and the reset, each one undo step', () => {
    const api = demo();
    api.setCellPlayMode(KICK, 'sequence');
    api.setCellReset(KICK, { kind: 'zone', drumId: 'kick', slot: 1 });
    expect(api.cellPlay(KICK)).toEqual({ cell: KICK, mode: 'sequence', reset: { kind: 'zone', drumId: 'kick', slot: 1 } });
    expect(api.undoDepth).toBe(2);
    api.undo();
    expect(api.cellPlay(KICK)?.reset).toBeUndefined();
  });

  it('arms reset Learn only on a Sequence / Random cell, and cancelCueLearn disarms it', () => {
    const api = demo();
    api.startCellResetLearn(KICK, 'midi');
    expect(api.cellResetLearnCell).toBeNull(); // a layering cell has no reset to learn
    api.setCellPlayMode(KICK, 'sequence');
    api.startCellResetLearn(KICK, 'midi');
    expect(api.cellResetLearnCell).toEqual(KICK);
    api.cancelCueLearn();
    expect(api.cellResetLearnCell).toBeNull();
  });

  it('lastPlayedStep follows the fire flashes, skipping bypassed rows', () => {
    const api = demo();
    expect(api.lastPlayedStep(KICK)).toBeNull();
    api.fireEffect('b');
    expect(api.lastPlayedStep(KICK)).toBe(1);
    api.setEffectBypass('a', true); // a no longer counts as a step: b is now step 0
    expect(api.lastPlayedStep(KICK)).toBe(0);
  });
});

describe('saving', () => {
  it('a saved section keeps its cell play; an unreadable or Layer entry is dropped', () => {
    const authored = coerceAuthoredV3({
      songs: [{ id: 'song', name: 'Song', sections: [{
        id: 's', name: 'S', effects: [], master: [],
        cellPlay: [
          { cell: KICK, mode: 'random', reset: { kind: 'osc', address: '/r' } },
          { cell: KICK, mode: 'bogus' },
          { cell: ALWAYS, mode: 'layer' },
        ],
      }] }],
    });
    expect(authored.songs![0]!.sections[0]!.cellPlay).toEqual([{ cell: KICK, mode: 'random', reset: { kind: 'osc', address: '/r' } }]);
  });
});
