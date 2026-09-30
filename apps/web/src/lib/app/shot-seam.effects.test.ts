import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../trigger-lab/effects-controller.svelte';
import { resolveGridCell } from './shot-seam';

/* The `cell:<row>:<col>` ui-shot op's addressing. */
const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' },
  ],
};
const api = createStandaloneEffectsApi({ effects: [], master: [] }, kit);

describe('resolveGridCell', () => {
  it('addresses a row by id or label and a column by index, trigger kind, or zone slot', () => {
    expect(resolveGridCell(api, 'kick:0')).toEqual({ row: 'kick', column: { kind: 'zone', slot: 0 } });
    expect(resolveGridCell(api, 'Snare:z1')).toEqual({ row: 'snare', column: { kind: 'zone', slot: 1 } });
    expect(resolveGridCell(api, 'kit:always')).toEqual({ row: 'kit', column: { kind: 'always' } });
    expect(resolveGridCell(api, 'kick:4')).toEqual({ row: 'kick', column: { kind: 'cue' } });
  });

  it('is null for an unknown row or column', () => {
    expect(resolveGridCell(api, 'tom:0')).toBeNull();
    expect(resolveGridCell(api, 'kick')).toBeNull();
    expect(resolveGridCell(api, 'kick:z7')).toBeNull();
    expect(resolveGridCell(api, 'kick:9')).toBeNull();
  });
});
