/* Section Effect summaries for the Sections / Objects views (effect chains S06c) — PURE (no runes,
   no DOM, no store). The authoring api only reads the ACTIVE section, but the Sections view shows
   every section of the song side by side, so these helpers read a section value directly and
   group its `effects` by cell in grid order, using the api's (section-independent) grid rows and
   columns for order and labels. A section value without `effects` / `master` reads as an empty
   grid rather than throwing. */

import { tryGetModifier, type effectChain } from '@ledrums/core';
import type { GridColumn, GridRow } from '../../trigger-lab/effects-api';
import { sameCell, type EffectsSection } from '../../trigger-lab/effects-doc';
import { effectsInGridOrder } from '../../trigger-lab/grid-model';

type EffectCell = effectChain.EffectCell;
type EffectColumn = effectChain.EffectColumn;

/** One occupied cell in a section column: its Effects' names, in stack order. */
export interface SectionCellSummary {
  /** Stable key for keyed `{#each}` (row + column). */
  key: string;
  cell: EffectCell;
  /** Row label (Kit / drum name). */
  rowLabel: string;
  /** Column label (zone name, Always, Clock, Cue). */
  columnLabel: string;
  /** Drum colour for the row chip; absent for the Kit row and unknown rows. */
  color?: string;
  names: string[];
  /** Every Effect in the cell is bypassed. */
  allBypassed: boolean;
}

/** The section's Effects view (`effects` / `master`), tolerating a section without them. */
export function sectionEffectsOf(section: unknown): EffectsSection {
  const s = (section ?? {}) as Partial<EffectsSection>;
  return {
    effects: Array.isArray(s.effects) ? s.effects : [],
    master: Array.isArray(s.master) ? s.master : [],
  };
}

/** How many Effects the section holds (its stack length). */
export function sectionEffectCount(section: unknown): number {
  return sectionEffectsOf(section).effects.length;
}

/** Total Effects across a song's sections. */
export function songEffectCount(song: { sections: readonly unknown[] }): number {
  return song.sections.reduce<number>((sum, section) => sum + sectionEffectCount(section), 0);
}

export function cellKey(cell: EffectCell): string {
  const col = cell.column.kind === 'zone' ? `zone${cell.column.slot}` : cell.column.kind;
  return `${cell.row}/${col}`;
}

function fallbackColumnLabel(column: EffectColumn): string {
  if (column.kind === 'zone') return `Zone ${column.slot + 1}`;
  return column.kind[0]!.toUpperCase() + column.kind.slice(1);
}

function sameColumn(a: EffectColumn, b: EffectColumn): boolean {
  return sameCell({ row: '', column: a }, { row: '', column: b });
}

/**
 * The section's occupied cells, in grid order (rows × columns), each with its Effect names in
 * stack order. Cells the grid does not show (a drum since removed, a zone the input map lost)
 * follow in composition order, labelled from the raw cell, so no Effect is hidden.
 */
export function sectionCellSummaries(
  section: unknown,
  rows: readonly GridRow[],
  columns: readonly GridColumn[],
): SectionCellSummary[] {
  const ordered = effectsInGridOrder(sectionEffectsOf(section), rows, columns);
  const out: SectionCellSummary[] = [];
  const byKey = new Map<string, SectionCellSummary>();
  for (const effect of ordered) {
    const key = cellKey(effect.cell);
    let summary = byKey.get(key);
    if (!summary) {
      const row = rows.find((r) => r.id === effect.cell.row);
      const column = columns.find((c) => sameColumn(c.column, effect.cell.column));
      summary = {
        key,
        cell: effect.cell,
        rowLabel: row?.label ?? effect.cell.row,
        columnLabel: column?.label ?? fallbackColumnLabel(effect.cell.column),
        names: [],
        allBypassed: true,
      };
      if (row?.color) summary.color = row.color;
      byKey.set(key, summary);
      out.push(summary);
    }
    summary.names.push(effect.name);
    if (!effect.bypass) summary.allBypassed = false;
  }
  return out;
}

/** The section's Master chain as a summary row, or null when it has no modifiers. */
export interface MasterSummary {
  names: string[];
  allBypassed: boolean;
}

export function sectionMasterSummary(section: unknown): MasterSummary | null {
  const { master } = sectionEffectsOf(section);
  if (master.length === 0) return null;
  return {
    names: master.map((m) => tryGetModifier(m.modifierId)?.name ?? m.modifierId),
    allBypassed: master.every((m) => m.bypass),
  };
}
