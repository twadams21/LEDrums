/* Song-library REFERENCES — the inverse of extraction (S41, doc 07 §B). A PURE module (no runes,
   no DOM), like song-library / shows, so resolve / detach / library-CRUD / the delete guard are
   unit-testable in node.

   A show references library songs by id (`AuthoredState.songRefs`). {@link resolveSongRefs} is the
   INVERSE of {@link import('./song-library').extractSongClosure}: it unions each referenced
   {@link LibrarySong}'s already-namespaced closure back into a show's runtime view — graphs +
   names + effects + presets union collision-free (extraction's per-song `lib:<id>/` prefix
   guarantees disjointness), and each referenced song appears as a runtime {@link Song}. A look's
   `busId` keys stayed SHOW-LEVEL through extraction, so they resolve against the IMPORTING show's
   buses by natural key match — no transform here.

   CANONICAL PROPAGATION falls out for free: the referenced closure lives once in the library, so
   editing the library song and re-resolving updates every show that references it. DETACH is the
   escape hatch — {@link detachLibrarySong} clones the closure into the show under a FRESH namespace
   as a local song, severing the link. The DELETE GUARD ({@link planDeleteLibrarySong}) blocks
   removing a library song any show still references, reporting the using shows. */

import type { EffectDef, Preset, TriggerGraph } from '../sim';
import type { Song, SetlistSection } from '../../app/setlist';
import type { LibrarySong } from './song-library';
import { songNamespace } from './song-library';
import type { SongLibrary } from '../persistence';

/** The subset of a show's authored runtime view a resolve unions references INTO / reads FROM.
    Mirrors the {@link import('../persistence').AuthoredState} fields a song closure touches. */
export interface ResolvableView {
  songs: Song[];
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  effects: EffectDef[];
  presets: Preset[];
}

// ---- resolve: union referenced closures into the runtime view ----------------

/**
 * Materialize a show's referenced library songs into its runtime view — the inverse of closure
 * EXTRACTION. Pure + deterministic. For each id in `refs` present in `library.songs`, the song's
 * namespaced graphs/graphNames are spread in and its effects/presets appended (id-deduped, though
 * the `lib:<id>/` prefix already makes every referenced closure disjoint from the base view AND
 * from every other reference), and the song itself is appended to the song list (its sections are
 * already namespaced + internally consistent from extraction). Refs are applied in order; a
 * duplicate or dangling ref is skipped (idempotent, faithful — a missing library song resolves to
 * nothing, exactly as a dangling graph ref renders nothing). The base view's own arrays are never
 * mutated — a fresh view is returned.
 */
export function resolveSongRefs(base: ResolvableView, refs: readonly string[], library: SongLibrary): ResolvableView {
  const graphs: Record<string, TriggerGraph> = { ...base.graphs };
  const graphNames: Record<string, string> = { ...base.graphNames };
  const effects = [...base.effects];
  const presets = [...base.presets];
  const songs = [...base.songs];

  const effectIds = new Set(effects.map((e) => e.id));
  const presetIds = new Set(presets.map((p) => p.id));
  const seenRefs = new Set<string>();

  for (const id of refs) {
    if (seenRefs.has(id)) continue; // a ref list should be a set; guard a stray duplicate
    seenRefs.add(id);
    const lib = library.songs[id];
    if (!lib) continue; // dangling ref → resolves to nothing (faithful, not repaired)

    Object.assign(graphs, lib.graphs);
    Object.assign(graphNames, lib.graphNames);
    for (const e of lib.effects) {
      if (!effectIds.has(e.id)) {
        effectIds.add(e.id);
        effects.push(e);
      }
    }
    for (const p of lib.presets) {
      if (!presetIds.has(p.id)) {
        presetIds.add(p.id);
        presets.push(p);
      }
    }
    songs.push({ id: lib.id, name: lib.name, sections: lib.sections });
  }

  return { songs, graphs, graphNames, effects, presets };
}

// ---- detach: clone a referenced closure into the show, fresh namespace -------

/** A library song cloned into a show as a LOCAL copy under a fresh namespace — the pieces the
    store merges into its authored runes (and the ref it then drops). Everything is deep-copied, so
    the detached copy aliases NOTHING in the library song. */
export interface DetachedSong {
  song: Song;
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  effects: EffectDef[];
  presets: Preset[];
}

/**
 * Clone a {@link LibrarySong} into a show as a local, independent song under a FRESH namespace —
 * the "detach to local copy" escape hatch that severs canonical propagation. The library song's
 * ids are all prefixed with `songNamespace(song.id)`; every such prefix is re-based to
 * `songNamespace(newSongId)` (global ids — `modifierId`/`generatorId` — and empty ids carry no
 * prefix and pass through untouched). Deep-cloned FIRST so the result shares no object with the
 * library copy (a later edit to either can't write through the other). Pure; `newSongId` is
 * injected so the caller controls id minting and tests stay deterministic.
 */
export function detachLibrarySong(song: LibrarySong, newSongId: string): DetachedSong {
  const oldPrefix = songNamespace(song.id);
  const newPrefix = songNamespace(newSongId);
  const rebase = (key: string): string => (key.startsWith(oldPrefix) ? newPrefix + key.slice(oldPrefix.length) : key);

  const graphs: Record<string, TriggerGraph> = {};
  const graphNames: Record<string, string> = {};
  for (const [key, graph] of Object.entries(song.graphs)) {
    const clone = structuredClone(graph);
    for (const n of clone.nodes) {
      n.effectId = rebase(n.effectId);
      n.presetId = rebase(n.presetId);
    }
    graphs[rebase(key)] = clone;
  }
  for (const [key, name] of Object.entries(song.graphNames)) graphNames[rebase(key)] = name;

  const effects = song.effects.map((e) => ({ ...structuredClone(e), id: rebase(e.id) }));
  const presets = song.presets.map((p) => ({ ...structuredClone(p), id: rebase(p.id), effectId: rebase(p.effectId) }));

  const sections: SetlistSection[] = song.sections.map((sec) => {
    const looks: Record<string, string | null> = {};
    for (const [busId, effectId] of Object.entries(sec.looks)) looks[busId] = effectId ? rebase(effectId) : effectId;
    return { id: rebase(sec.id), name: sec.name, graphs: sec.graphs.map(rebase), looks };
  });

  return { song: { id: newSongId, name: song.name, sections }, graphs, graphNames, effects, presets };
}

// ---- library CRUD (pure map arithmetic, mirrors store/shows.ts) --------------

/** Insert / replace a song in the library (immutable). */
export function withLibrarySong(library: SongLibrary, song: LibrarySong): SongLibrary {
  return { songs: { ...library.songs, [song.id]: song } };
}

/** Rename a library song. Returns the SAME library ref on an unknown id or a blank name (keeps
    the old name, mirrors {@link import('./shows').renameShowIn}). */
export function renameLibrarySongIn(library: SongLibrary, id: string, name: string): SongLibrary {
  const song = library.songs[id];
  if (!song) return library;
  const trimmed = name.trim();
  if (!trimmed) return library;
  return { songs: { ...library.songs, [id]: { ...song, name: trimmed } } };
}

/** Remove a song from the library (immutable). Returns the SAME ref when the id is absent. This is
    the UNGUARDED removal — callers gate it behind {@link planDeleteLibrarySong}. */
export function removeLibrarySong(library: SongLibrary, id: string): SongLibrary {
  if (!library.songs[id]) return library;
  const songs = { ...library.songs };
  delete songs[id];
  return { songs };
}

// ---- ref list edits ----------------------------------------------------------

/** Append a library-song reference (idempotent — an id already referenced is a no-op, keeping the
    list a set-like ordered list, mirroring setlist `addGraph`). Returns the SAME ref when unchanged. */
export function addSongRef(refs: readonly string[], id: string): string[] {
  return refs.includes(id) ? (refs as string[]) : [...refs, id];
}

/** Drop a library-song reference (no-op if absent). */
export function removeSongRef(refs: readonly string[], id: string): string[] {
  return refs.includes(id) ? refs.filter((r) => r !== id) : (refs as string[]);
}

// ---- delete guard: which shows reference a library song ----------------------

/** A show identified for the used-by guard — `{ id, name, songRefs }`. The store adapts its
    {@link import('../persistence').Show} slots (+ the live active-show refs) to this shape. */
export interface RefBearingShow {
  id: string;
  name: string;
  songRefs?: readonly string[];
}

/** The shows (id + name) that reference `librarySongId`, in the given order — the "used by" list a
    delete guard reports and the UI shows. */
export function showsUsingSong(shows: readonly RefBearingShow[], librarySongId: string): { id: string; name: string }[] {
  return shows
    .filter((s) => (s.songRefs ?? []).includes(librarySongId))
    .map((s) => ({ id: s.id, name: s.name }));
}

/** The outcome of a deleteLibrarySong request — the store applies it:
      - `blocked` — one or more shows still reference the song; `usedBy` names them, nothing changes;
      - `remove`  — no show references it; `library` is the new pool with the song gone. */
export type DeleteSongPlan =
  | { kind: 'blocked'; usedBy: { id: string; name: string }[] }
  | { kind: 'remove'; library: SongLibrary };

/**
 * Decide whether `librarySongId` may be deleted from the pool. BLOCKED with the using-show list
 * whenever any show references it (canonical propagation means deleting it would silently strip
 * content from those shows); otherwise removed. An unknown id is a `remove` no-op (nothing
 * references a song that isn't there). Mirrors {@link import('./shows').planDeleteShow}'s
 * plan-shaped contract.
 */
export function planDeleteLibrarySong(
  library: SongLibrary,
  shows: readonly RefBearingShow[],
  librarySongId: string,
): DeleteSongPlan {
  const usedBy = showsUsingSong(shows, librarySongId);
  if (usedBy.length > 0) return { kind: 'blocked', usedBy };
  return { kind: 'remove', library: removeLibrarySong(library, librarySongId) };
}
