/* Pure view-models for the Objects view — the master-detail index of authored objects
   (Songs · Song Library · Canvas Scenes). DOM-free / rune-free so the joins + sort order + the
   delete-gating are unit-testable in isolation (the .svelte file is thin UI over these). Each
   builder takes plain arrays (the store's reactive lists snapshot fine) and returns sorted row
   records. */
import type { CanvasScene } from '@ledrums/core';
import type { Song } from '../setlist';
import { songEffectCount } from './section-effects';

/** The object types the Objects view indexes, in rail order. (Icons live in the
    .svelte; this module is DOM-free.) */
export type ObjectTypeId = 'songs' | 'library' | 'canvas-scenes';

export const OBJECT_TYPE_IDS: readonly ObjectTypeId[] = ['songs', 'library', 'canvas-scenes'];

/** A song row's sub-line: its section count, plus its Effect total when it has any
    ("3 sections · 12 effects"). */
export function songSubline(sectionCount: number, effectCount: number): string {
  const sections = `${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`;
  if (effectCount === 0) return sections;
  return `${sections} · ${effectCount} ${effectCount === 1 ? 'effect' : 'effects'}`;
}

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
  /** Effects across the song's sections. */
  effectCount: number;
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
    effectCount: songEffectCount(s),
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

/** A canvas-scene row: the scene id/name plus a summary of its authored content (element +
    lens counts and sampler kind) for the sub-line. Sorted by name then id. `builtin` rows
    come from the core seed library (U6): read-only — view JSON + duplicate only, never
    rename/edit/delete (duplicate makes an authored copy to customise). */
export interface CanvasSceneRow {
  id: string;
  name: string;
  elementCount: number;
  lensCount: number;
  sampler: string;
  builtin: boolean;
}

export function canvasSceneRows(scenes: readonly CanvasScene[], builtin = false): CanvasSceneRow[] {
  return scenes
    .map((scene) => ({
      id: scene.id,
      name: scene.name,
      elementCount: scene.elements.length,
      lensCount: scene.lenses?.length ?? 0,
      sampler: scene.sampler.kind,
      builtin,
    }))
    .sort(byNameThenId);
}
