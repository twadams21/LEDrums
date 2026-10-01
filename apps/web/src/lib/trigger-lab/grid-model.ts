/* Effects grid read model (effect chains, S05 §2) — pure derivations the grid UI renders:
   rows (the Kit, then drums in kit order), columns (the union of zone slots across drums, then
   Always / Clock / Cue), per-cell summaries, and the grid-order Effect list keys 1–9 / 0 audition.

   Zone identity is the numeric slot, never the name. A drum's zones are the slots declared in the
   input map OR bound to a MIDI note / OSC address — the same definition the Patch inspector uses
   (duplicated here on purpose: that module belongs to the Patch-graph editor S08 removes). */

import { effectChain, SLOT_LABELS, type InputMap, type KitConfig } from '@ledrums/core';
import type { CellSummary, GridColumn, GridRow } from './effects-api';
import { sameCell, type EffectsSection } from './effects-doc';

type Effect = effectChain.Effect;
type EffectCell = effectChain.EffectCell;
type EffectColumn = effectChain.EffectColumn;

const TRIGGER_COLUMNS: readonly GridColumn[] = [
  { column: { kind: 'always' }, label: 'Always' },
  { column: { kind: 'clock' }, label: 'Clock' },
  { column: { kind: 'cue' }, label: 'Cue' },
];

/** The zone slots a drum has, ascending: declared (`zones`) or bound (MIDI note / OSC address). */
export function zoneSlotsForDrum(inputMap: InputMap, drumId: string): number[] {
  const slots = new Set<number>();
  for (const z of inputMap.zones ?? []) if (z.drumId === drumId) slots.add(z.slot);
  for (const n of inputMap.midiNotes ?? []) if (n.drumId === drumId) slots.add(n.slot);
  for (const o of inputMap.oscMap ?? []) if (o.drumId === drumId) slots.add(o.slot);
  return [...slots].sort((a, b) => a - b);
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** A zone's display name on a drum: its stored label, else the slot's default name. */
export function zoneName(inputMap: InputMap, drumId: string, slot: number): string {
  const stored = (inputMap.zones ?? []).find((z) => z.drumId === drumId && z.slot === slot)?.label?.trim();
  return stored || capitalise(SLOT_LABELS[slot] ?? `Zone ${slot + 1}`);
}

function drumLabel(kit: KitConfig, drumId: string): string {
  const drum = kit.drums.find((d) => d.id === drumId);
  return drum?.label?.trim() || drumId;
}

/** The Kit row, then one row per drum in kit order. */
export function gridRows(kit: KitConfig): GridRow[] {
  return [
    { id: effectChain.KIT_ROW, label: 'Kit' },
    ...kit.drums.map((d) => ({ id: d.id, label: d.label?.trim() || d.id, color: d.color })),
  ];
}

/**
 * Zone columns for every slot any drum has (ascending), then Always / Clock / Cue. A zone header
 * is the zone's name when every drum having that slot agrees on it, else "Zone N".
 */
export function gridColumns(kit: KitConfig, inputMap: InputMap): GridColumn[] {
  const bySlot = new Map<number, Set<string>>();
  for (const drum of kit.drums) {
    for (const slot of zoneSlotsForDrum(inputMap, drum.id)) {
      const names = bySlot.get(slot) ?? new Set<string>();
      names.add(zoneName(inputMap, drum.id, slot));
      bySlot.set(slot, names);
    }
  }
  const zones = [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, names]): GridColumn => ({
      column: { kind: 'zone', slot },
      label: names.size === 1 ? [...names][0]! : `Zone ${slot + 1}`,
    }));
  return [...zones, ...TRIGGER_COLUMNS];
}

function columnLabel(column: EffectColumn): string {
  if (column.kind === 'zone') return `Zone ${column.slot + 1}`;
  return TRIGGER_COLUMNS.find((c) => c.column.kind === column.kind)!.label;
}

/** Whether a cell can hold Effects: a known row, and a zone column only on a drum that has it. */
export function cellEnabled(kit: KitConfig, inputMap: InputMap, cell: EffectCell): boolean {
  const isKit = cell.row === effectChain.KIT_ROW;
  if (!isKit && !kit.drums.some((d) => d.id === cell.row)) return false;
  if (cell.column.kind !== 'zone') return true;
  return !isKit && zoneSlotsForDrum(inputMap, cell.row).includes(cell.column.slot);
}

/** What the cell face shows: enabled state, stack count, first Effect, bypass, a human label. */
export function cellSummary(section: EffectsSection | null, cell: EffectCell, kit: KitConfig, inputMap: InputMap): CellSummary {
  const stack = section ? section.effects.filter((e) => sameCell(e.cell, cell)) : [];
  const first = stack[0];
  const enabled = cellEnabled(kit, inputMap, cell);
  const label = cell.column.kind === 'zone' && enabled
    ? `${drumLabel(kit, cell.row)} ${zoneName(inputMap, cell.row, cell.column.slot).toLowerCase()}`
    : columnLabel(cell.column);
  const summary: CellSummary = {
    enabled,
    count: stack.length,
    allBypassed: stack.length > 0 && stack.every((e) => e.bypass),
    label,
  };
  if (first) {
    summary.firstName = first.name;
    summary.firstGenerator = first.generator.kind;
  }
  return summary;
}

/** One audition key's worth: a single Effect, or a whole Sequence / Random cell. */
export type AuditionSlot = { kind: 'effect'; effect: Effect } | { kind: 'cell'; cell: EffectCell };

/**
 * What keys 1–9 / 0 play, in grid order. Every Effect is its own key, EXCEPT the Effects of a
 * Sequence / Random cell, which share one key at the place of the cell's first Effect — the cell
 * is one instrument that steps, so pressing its key again plays its next step (Tim, 2026-10-01:
 * "it should be the same number").
 */
export function auditionSlots(section: EffectsSection | null, rows: readonly GridRow[], columns: readonly GridColumn[]): AuditionSlot[] {
  const slots: AuditionSlot[] = [];
  const stepped = new Set<string>();
  for (const effect of effectsInGridOrder(section, rows, columns)) {
    if (section && effectChain.cellPlayMode(section, effect.cell) !== 'layer') {
      const key = effectChain.cellKey(effect.cell);
      if (!stepped.has(key)) slots.push({ kind: 'cell', cell: effect.cell });
      stepped.add(key);
    } else {
      slots.push({ kind: 'effect', effect });
    }
  }
  return slots;
}

/** Every Effect in grid order: row by row, column by column, each cell's stack in stack order.
    Effects in cells the grid does not show come last, in composition order. */
export function effectsInGridOrder(section: EffectsSection | null, rows: readonly GridRow[], columns: readonly GridColumn[]): Effect[] {
  if (!section) return [];
  const ordered: Effect[] = [];
  const placed = new Set<Effect>();
  for (const row of rows) {
    for (const col of columns) {
      const cell: EffectCell = { row: row.id, column: col.column };
      for (const effect of section.effects) {
        if (!placed.has(effect) && sameCell(effect.cell, cell)) {
          ordered.push(effect);
          placed.add(effect);
        }
      }
    }
  }
  for (const effect of section.effects) if (!placed.has(effect)) ordered.push(effect);
  return ordered;
}
