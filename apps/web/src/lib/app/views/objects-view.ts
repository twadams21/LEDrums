/* Pure view-models for the Objects view — the master-detail index of authored objects
   (Songs · Effects · Graphs · Presets). DOM-free / rune-free so the joins + sort order +
   the preset delete-gating are unit-testable in isolation (the .svelte file is thin UI over
   these). Each builder takes plain arrays (the store's reactive lists snapshot fine) and the
   store's `presetUsageCount` as a pure callback, and returns sorted row records. */
import type { EffectDef, Preset } from '../../trigger-lab/sim';

/** The four object types the Objects view indexes, in rail order. (Icons live in the
    .svelte; this module is DOM-free.) */
export type ObjectTypeId = 'songs' | 'effects' | 'graphs' | 'presets';

export const OBJECT_TYPE_IDS: readonly ObjectTypeId[] = ['songs', 'effects', 'graphs', 'presets'];

/** Stable name-then-id comparator, so equal names keep a deterministic order across reloads. */
function byNameThenId(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** An effect row: the effect plus how many presets target it (its "detail"). Foundational —
    the Objects view offers rename + duplicate only, never delete. Sorted by name then id. */
export interface EffectRow {
  id: string;
  name: string;
  presetCount: number;
}

export function effectRows(effects: readonly EffectDef[], presets: readonly Preset[]): EffectRow[] {
  const counts = new Map<string, number>();
  for (const p of presets) counts.set(p.effectId, (counts.get(p.effectId) ?? 0) + 1);
  return effects
    .map((e) => ({ id: e.id, name: e.name, presetCount: counts.get(e.id) ?? 0 }))
    .sort(byNameThenId);
}

/** A preset row: the preset, its parent effect's name, the live usage count, and whether it
    can be deleted right now. `deletable` mirrors the store's {@link deletePreset} guard exactly
    — unused AND not a live effect's foundational `:default` — so the menu disables Delete in
    lockstep with what the store would accept. Sorted by effect name, then preset name, then id. */
export interface PresetRow {
  id: string;
  name: string;
  effectId: string;
  effectName: string;
  usage: number;
  isDefault: boolean;
  deletable: boolean;
}

export function presetRows(
  presets: readonly Preset[],
  effects: readonly EffectDef[],
  usageOf: (id: string) => number,
): PresetRow[] {
  const effName = new Map(effects.map((e) => [e.id, e.name] as const));
  const liveEffect = new Set(effects.map((e) => e.id));
  return presets
    .map((p) => {
      const usage = usageOf(p.id);
      // a `:default` is foundational only while its effect still exists (matches deletePreset).
      const isDefault = p.id.endsWith(':default') && liveEffect.has(p.effectId);
      return {
        id: p.id,
        name: p.name,
        effectId: p.effectId,
        effectName: effName.get(p.effectId) ?? p.effectId,
        usage,
        isDefault,
        deletable: usage === 0 && !isDefault,
      };
    })
    .sort(
      (a, b) =>
        a.effectName.localeCompare(b.effectName) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

/** A graph row: a key + display label from {@link TriggerLab.graphLibrary}, sorted by label
    then key. The source sub-line (e.g. "Kick · center") is resolved in the view (it needs the
    drum roster), not here. */
export interface GraphRow {
  key: string;
  label: string;
}

export function graphRows(library: readonly { key: string; label: string }[]): GraphRow[] {
  return [...library].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
