/* Effect-chains song library (S05) — the PURE export / resolve / detach cores over the v2 song
   library, the effect-chain twins of `song-library.ts` (extract) and `song-library-refs.ts`
   (resolve / detach). No runes, no DOM.

   A library song is self-contained: its sections carry their Effect stacks and master chains
   inline (there is no graph / preset closure any more), plus the canvas scenes those Effects
   play. Section ids are namespaced `lib:<songId>/<sectionId>` exactly as the graph-era closure
   did, so a referenced song's sections never collide with a show's own — core
   `buildRuntimeShow` uses them as-is. Effect ids only have to be unique within a section, so
   they travel verbatim. */

import type { CanvasScene } from '@ledrums/core';
import type { SetlistSection, Song } from '../../app/setlist';
import { buildCellClipDoc } from '../clipdoc';
import type { EffectLibrarySong, EffectSection, EffectSong, SongLibraryV2 } from '../persistence';
import { songNamespace } from './song-library';

const EMPTY: never[] = [];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A store (setlist) section as its v3 effect section: the graph-era fields are dropped. */
export function toEffectSection(section: SetlistSection): EffectSection {
  const out: EffectSection = {
    id: section.id,
    name: section.name,
    effects: section.effects ?? EMPTY,
    master: section.master ?? EMPTY,
  };
  if (section.bars !== undefined) out.bars = section.bars;
  if (section.bpm !== undefined) out.bpm = section.bpm;
  return out;
}

/** A store song as its v3 effect song (references, not copies — snapshot at the boundary). */
export function toEffectSong(song: Song): EffectSong {
  return { id: song.id, name: song.name, sections: song.sections.map(toEffectSection) };
}

/** A v3 effect section as a store section. The store keeps the graph-era `graphs` / `looks`
    fields (always empty now) until S08 deletes the graph model; a store section passes through. */
export function toStoreSection(section: EffectSection | SetlistSection): SetlistSection {
  const legacy = section as Partial<SetlistSection>;
  const out: SetlistSection = {
    id: section.id,
    name: section.name,
    graphs: Array.isArray(legacy.graphs) ? legacy.graphs : [],
    looks: legacy.looks && typeof legacy.looks === 'object' ? legacy.looks : {},
    effects: section.effects ?? [],
    master: section.master ?? [],
  };
  if (section.bars !== undefined) out.bars = section.bars;
  if (section.bpm !== undefined) out.bpm = section.bpm;
  return out;
}

export function toStoreSong(song: EffectSong | Song): Song {
  return { id: song.id, name: song.name, sections: song.sections.map(toStoreSection) };
}

/** The show's canvas scenes the section's Effects play (the ClipDoc dependency rule). */
function scenesFor(sections: readonly EffectSection[], canvasScenes: readonly CanvasScene[]): CanvasScene[] {
  const out: CanvasScene[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (section.effects.length === 0) continue;
    const cell = section.effects[0]!.cell;
    for (const scene of buildCellClipDoc(cell, section.effects, { canvasScenes }).deps.canvasScenes ?? []) {
      if (seen.has(scene.id)) continue;
      seen.add(scene.id);
      out.push(scene);
    }
  }
  return out;
}

/**
 * Export a show's song into a self-contained library song under `librarySongId`: sections
 * deep-copied with namespaced ids, plus the canvas scenes its Effects play. The source is
 * never aliased.
 */
export function extractEffectSong(song: Song, canvasScenes: readonly CanvasScene[], librarySongId: string): EffectLibrarySong {
  const prefix = songNamespace(librarySongId);
  const sections = cloneJson(song.sections.map(toEffectSection)).map((section) => ({ ...section, id: `${prefix}${section.id}` }));
  const out: EffectLibrarySong = { id: librarySongId, name: song.name, sections };
  const scenes = scenesFor(sections, canvasScenes);
  if (scenes.length > 0) out.canvasScenes = scenes;
  return out;
}

/**
 * The runtime song list: the show's own songs, then each referenced library song in `refs`
 * order (duplicate / dangling refs skipped, and a library section whose id the show already
 * has skipped) — the same policy core `buildRuntimeShow` applies, so the Songs rail, recall and
 * the engine agree on every id.
 */
export function resolveEffectSongRefs(songs: readonly Song[], refs: readonly string[], library: SongLibraryV2): Song[] {
  const out = [...songs];
  const seenRefs = new Set<string>();
  const seenSectionIds = new Set(songs.flatMap((song) => song.sections.map((section) => section.id)));
  for (const ref of refs) {
    if (seenRefs.has(ref)) continue;
    seenRefs.add(ref);
    const lib = library.songs[ref];
    if (!lib) continue;
    const sections = lib.sections.filter((section) => {
      if (!section.id || seenSectionIds.has(section.id)) return false;
      seenSectionIds.add(section.id);
      return true;
    });
    out.push(toStoreSong({ id: lib.id, name: lib.name, sections }));
  }
  return out;
}

/** A library song detached into a show: a local song plus the scenes it brings. */
export interface DetachedEffectSong {
  song: Song;
  canvasScenes: CanvasScene[];
}

/**
 * Clone a library song into a show as an independent local song: a fresh song id and a fresh
 * id per section (`mintSectionId`), Effects deep-copied. Scenes are returned for the caller to
 * union into the show (by id — a scene the show already has is not duplicated there).
 */
export function detachEffectSong(lib: EffectLibrarySong, newSongId: string, mintSectionId: () => string): DetachedEffectSong {
  const sections = cloneJson(lib.sections).map((section) => toStoreSection({ ...section, id: mintSectionId() }));
  return { song: { id: newSongId, name: lib.name, sections }, canvasScenes: cloneJson(lib.canvasScenes ?? []) };
}
