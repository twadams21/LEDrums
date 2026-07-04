/* Pure view-models for the Objects view — the master-detail index of authored objects
   (Songs · Effects · Graphs · Presets). DOM-free / rune-free so the joins + sort order +
   the preset delete-gating are unit-testable in isolation (the .svelte file is thin UI over
   these). Each builder takes plain arrays (the store's reactive lists snapshot fine) and the
   store's `presetUsageCount` as a pure callback, and returns sorted row records. */
import type { EffectDef, Preset } from '../../trigger-lab/sim';
import type { Song } from '../setlist';

/** The four object types the Objects view indexes, in rail order. (Icons live in the
    .svelte; this module is DOM-free.) */
export type ObjectTypeId = 'songs' | 'library' | 'effects' | 'graphs' | 'presets';

export const OBJECT_TYPE_IDS: readonly ObjectTypeId[] = ['songs', 'library', 'effects', 'graphs', 'presets'];

/** Stable name-then-id comparator, so equal names keep a deterministic order across reloads. */
function byNameThenId(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

// ---- songs: this-show setlist vs the shared Song Library (S42) ---------------
// The Songs tab splits its detail by SOURCE: the songs in THIS show's setlist (local authored
// songs + resolved library references) and the whole Song Library pool. `origin` marks a
// setlist row as a local song (fully editable here) or a `reference` to a library song (edits
// route to the library copy; "Detach copy" clones it local). Pool rows carry the used-by guard.

/** One row in the "This show" setlist group: a local song or a resolved library reference.
    `sectionCount` is the row's sub-line; `origin` drives the badge + which verbs apply. */
export interface ShowSongRow {
  id: string;
  name: string;
  sectionCount: number;
  origin: 'local' | 'reference';
}

/** The active show's setlist rows in play order — local authored songs first (from `local`),
    then resolved library references (the tail of `resolved` not present locally). Order follows
    `resolved` (which is `[...local, ...referenced]`); `origin` is `reference` for any resolved
    song whose id is not a local song id. Pure: both lists snapshot fine from the store's runes. */
export function showSongRows(local: readonly Song[], resolved: readonly Song[]): ShowSongRow[] {
  const localIds = new Set(local.map((s) => s.id));
  return resolved.map((s) => ({
    id: s.id,
    name: s.name,
    sectionCount: s.sections.length,
    origin: localIds.has(s.id) ? 'local' : 'reference',
  }));
}

/** One row in the "Song Library" pool group: a library song with its used-by guard state.
    `usedByNames` names the shows that reference it (the delete-blocked reason + the count);
    `inThisShow` mirrors the active show's refs (Import → Detach, and an "In this show" badge);
    `deletable` is the store's delete guard — true only when no show references it. */
export interface LibrarySongRow {
  id: string;
  name: string;
  usedByCount: number;
  usedByNames: string[];
  inThisShow: boolean;
  deletable: boolean;
}

/** Build the Song Library pool rows from the store's `songLibraryList` (`{id,name,usedBy[]}`)
    and the active show's `songRefs`. Insertion order preserved (the pool is authored order).
    Pure — mirrors the store's delete guard (`deletable` ⇔ empty used-by) so the UI disables
    Delete in lockstep with what {@link import('../../trigger-lab/store.svelte').TriggerLab.deleteLibrarySong} accepts. */
export function librarySongRows(
  list: readonly { id: string; name: string; usedBy: readonly { id: string; name: string }[] }[],
  activeRefs: readonly string[],
): LibrarySongRow[] {
  const refs = new Set(activeRefs);
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    usedByCount: s.usedBy.length,
    usedByNames: s.usedBy.map((u) => u.name),
    inThisShow: refs.has(s.id),
    deletable: s.usedBy.length === 0,
  }));
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
