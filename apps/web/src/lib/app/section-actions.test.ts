import { describe, expect, it, vi } from 'vitest';
import type { TriggerLab } from '../trigger-lab/store.svelte';
import { MASTER_CELL, type ApplyResult, type CellSelection, type EffectsAuthoringApi } from '../trigger-lab/effects-api';
import { sectionActions } from './section-actions';

/* The section menu's file verb: "Load cell / effect from file…" activates THIS section and loads
   an Effect / cell file into its selected cell (or the Kit · Always cell when none of its cells is
   selected), and is off whenever the section's song can't be edited — the same gate as every
   other section verb. The graph-era verbs are gone. */

const KIT_ALWAYS: CellSelection = { row: 'kit', column: { kind: 'always' } };
const KICK_HEAD: CellSelection = { row: 'kick', column: { kind: 'zone', slot: 0 } };

function stubs(opts: { canEdit?: boolean; activeSectionId?: string; selectedCell?: CellSelection | null; result?: ApplyResult } = {}) {
  const store = {
    activeSongById: { sections: [{ id: 's1' }, { id: 's2' }] },
    canEditActiveSong: opts.canEdit ?? true,
    activeSectionId: opts.activeSectionId ?? 's1',
    setActiveSection: vi.fn(),
  } as unknown as TriggerLab;
  const api = {
    selectedCell: opts.selectedCell ?? null,
    loadFileIntoCell: vi.fn(async () => opts.result ?? { ok: true }),
    selectCell: vi.fn(),
  } as unknown as EffectsAuthoringApi;
  return { store, api };
}

const loadAction = (store: TriggerLab, api: EffectsAuthoringApi, sectionId: string) =>
  sectionActions(store, sectionId, () => {}, api).find((action) => action.label === 'Load cell / effect from file…')!;

describe('sectionActions — Load cell / effect from file', () => {
  it('loads into the selected cell of the already-active section, then selects it', async () => {
    const { store, api } = stubs({ activeSectionId: 's2', selectedCell: KICK_HEAD });
    loadAction(store, api, 's2').onSelect();
    await vi.waitFor(() => expect(api.selectCell).toHaveBeenCalledWith(KICK_HEAD));
    expect(store.setActiveSection).toHaveBeenCalledWith('s2');
    expect(api.loadFileIntoCell).toHaveBeenCalledWith(KICK_HEAD);
  });

  it('activates another section and loads into its Kit · Always cell', async () => {
    const { store, api } = stubs({ activeSectionId: 's1', selectedCell: KICK_HEAD });
    loadAction(store, api, 's2').onSelect();
    await vi.waitFor(() => expect(api.loadFileIntoCell).toHaveBeenCalledWith(KIT_ALWAYS));
    expect(store.setActiveSection).toHaveBeenCalledWith('s2');
  });

  it('uses the Kit · Always cell when the Master is selected', async () => {
    const { store, api } = stubs({ activeSectionId: 's1', selectedCell: MASTER_CELL });
    loadAction(store, api, 's1').onSelect();
    await vi.waitFor(() => expect(api.loadFileIntoCell).toHaveBeenCalledWith(KIT_ALWAYS));
  });

  it('leaves the selection alone when the load does not apply', async () => {
    const { store, api } = stubs({ result: { ok: false, reason: 'nope' } });
    loadAction(store, api, 's1').onSelect();
    await vi.waitFor(() => expect(api.loadFileIntoCell).toHaveBeenCalled());
    await Promise.resolve();
    expect(api.selectCell).not.toHaveBeenCalled();
  });

  it('is disabled when the song is read-only', () => {
    const { store, api } = stubs({ canEdit: false });
    expect(loadAction(store, api, 's1').disabled).toBe(true);
  });

  it('no longer offers graph verbs', () => {
    const { store, api } = stubs();
    const labels = sectionActions(store, 's1', () => {}, api).map((a) => a.label);
    expect(labels).not.toContain('Load graph from file…');
    expect(labels).not.toContain('Add all missing default drum zone graphs');
  });
});
