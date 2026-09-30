/* Legacy-show import — the UI's read model (effect chains S06c), PURE. The notice, the setlist
   menu item and the confirm dialog all read `api.legacyImportAvailable` / `api.legacyShowNames`
   through here, so their gating is one rule and unit-tested.

   Semantics (assumed; the store owns them): `legacyImportAvailable` is "offer the notice" — it
   goes false once the old shows are imported OR the notice is dismissed. `legacyShowNames` is
   what an import would still bring across, so the on-demand menu item stays usable after a
   dismiss. Missing fields (a stub store before store-wire) read as "nothing to import". */

import type { EffectsAuthoringApi } from '../../trigger-lab/effects-api';

export type LegacyImportSource = Partial<Pick<EffectsAuthoringApi, 'legacyImportAvailable' | 'legacyShowNames'>>;

export interface LegacyImportView {
  /** Show the dismissible "import from the previous version" notice. */
  notice: boolean;
  /** The shows an import would bring across, in library order. */
  names: readonly string[];
  /** The import action (menu item / dialog confirm) can run. */
  canImport: boolean;
  /** Why the action is unavailable (menu label suffix / tooltip), when it is. */
  reason?: string;
}

export const NOTHING_TO_IMPORT = 'No shows from the previous version';

export function legacyImportView(api: LegacyImportSource, canEdit: boolean, viewingReason: string): LegacyImportView {
  const names = api.legacyShowNames ?? [];
  if (names.length === 0) return { notice: false, names, canImport: false, reason: NOTHING_TO_IMPORT };
  if (!canEdit) return { notice: false, names, canImport: false, reason: viewingReason };
  return { notice: api.legacyImportAvailable === true, names, canImport: true };
}

/** "Import 1 show" / "Import 3 shows". */
export function importLabel(count: number): string {
  return `Import ${count} ${count === 1 ? 'show' : 'shows'}`;
}
