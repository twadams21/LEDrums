import { describe, expect, it } from 'vitest';
import { NOTHING_TO_IMPORT, importLabel, legacyImportView } from './legacy-import-view';

/* One gating rule for the notice, the setlist-menu action and the dialog's confirm. */
describe('legacyImportView', () => {
  const names = ['Old Tour', 'Festival'];

  it('offers the notice and the action while old shows are waiting', () => {
    expect(legacyImportView({ legacyImportAvailable: true, legacyShowNames: names }, true, 'Viewing')).toEqual({
      notice: true,
      names,
      canImport: true,
    });
  });

  it('keeps the on-demand action after the notice is dismissed', () => {
    const view = legacyImportView({ legacyImportAvailable: false, legacyShowNames: names }, true, 'Viewing');
    expect(view).toMatchObject({ notice: false, canImport: true });
  });

  it('disables everything for a viewer, with the viewing reason', () => {
    expect(legacyImportView({ legacyImportAvailable: true, legacyShowNames: names }, false, 'Viewing')).toMatchObject({
      notice: false,
      canImport: false,
      reason: 'Viewing',
    });
  });

  it('reads nothing to import from an empty list or a store without the import surface', () => {
    for (const source of [{ legacyImportAvailable: true, legacyShowNames: [] }, {}]) {
      expect(legacyImportView(source, true, 'Viewing')).toEqual({ notice: false, names: [], canImport: false, reason: NOTHING_TO_IMPORT });
    }
  });
});

describe('importLabel', () => {
  it('pluralises the show count', () => {
    expect(importLabel(1)).toBe('Import 1 show');
    expect(importLabel(3)).toBe('Import 3 shows');
  });
});
