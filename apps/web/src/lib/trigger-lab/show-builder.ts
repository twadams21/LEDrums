/* Adapter: the store's authored v3 document → the runtime `voice.Show` the engine runs (the server
   engine, and the offline Sim's private core engine). It delegates to core
   `effectChain.buildRuntimeShow` — the builder the server restores from — so the web and the server
   build one Show from one library. */

import {
  effectChain,
  SHOWS_VERSION_EFFECTS,
  SONGS_VERSION_EFFECTS,
  voice,
  type CanvasScene,
} from '@ledrums/core';

/** One authored v3 section: the section stack plus its Master chain. */
export interface EffectsSectionSource {
  id: string;
  name: string;
  effects: readonly effectChain.Effect[];
  master: readonly effectChain.ModifierDevice[];
  bars?: number;
  bpm?: number;
}

/** One authored v3 song (a show's own, or a song-library entry). */
export interface EffectsSongSource {
  id: string;
  name: string;
  sections: readonly EffectsSectionSource[];
}

/** A song-library entry: already re-keyed under its `lib:<songId>/` namespace by extraction. */
export interface EffectsLibrarySongSource extends EffectsSongSource {
  canvasScenes?: readonly CanvasScene[];
}

/**
 * The v3 authored source: the ACTIVE show's authored state (refs unresolved, exactly as
 * persisted) plus the song library its `songRefs` point into.
 */
export interface EffectsShowSource {
  songs: readonly EffectsSongSource[];
  /** Ids into `songLibrary`, in setlist order. Duplicates / dangling refs are skipped by core. */
  songRefs: readonly string[];
  canvasScenes: readonly CanvasScene[];
  /** The show's MIDI-map InputMappings (`AuthoredV3.mappings`); core validates each one. */
  mappings?: readonly unknown[];
  /** The song library (`id → song`); `null` / absent when there is none. */
  songLibrary?: Readonly<Record<string, EffectsLibrarySongSource>> | null;
}

/** An assembled v3 Show plus every authored Effect / master modifier core left out of it. */
export interface EffectsShowBuild {
  show: voice.Show;
  diagnostics: effectChain.LibraryDiagnostic[];
}

/**
 * Assemble the runtime {@link voice.Show} for a v3 authored source through core
 * `effectChain.buildRuntimeShow` — the SAME builder the server's cold-start / backup restore
 * projects from the persisted blob, so the web and the server build one Show from one library.
 *
 * The source is wrapped as a one-show v3 library (+ a v2 song library) and parsed by core's
 * envelope schemas, so defaults and per-Effect validation match the server exactly: an invalid
 * Effect or master modifier is dropped and reported in `diagnostics`, never thrown. A
 * structurally unusable source (e.g. a section without an id) throws with the failing path.
 *
 * The source is JSON-snapshotted first: it may be the live store, whose `$state` proxies
 * `structuredClone` (used inside core) cannot copy — and the sent Show must never alias it.
 */
export function buildEffectsShow(source: EffectsShowSource): EffectsShowBuild {
  const authored = snapshot({
    songs: source.songs,
    songRefs: source.songRefs,
    canvasScenes: source.canvasScenes,
    ...(source.mappings?.length ? { mappings: source.mappings } : {}),
  });
  const showLib = effectChain.parseShowLibraryV3({
    version: SHOWS_VERSION_EFFECTS,
    data: { shows: { active: { authored } }, activeShowId: 'active' },
  });
  const songLib = source.songLibrary
    ? effectChain.parseSongLibraryV2({ version: SONGS_VERSION_EFFECTS, data: { songs: snapshot(source.songLibrary) } })
    : null;
  const { show, diagnostics } = effectChain.buildRuntimeShow(showLib, songLib);
  // One show in, so core always selects it; a null here is a core contract break.
  if (!show) throw new Error('buildEffectsShow: core buildRuntimeShow returned no show');
  return { show, diagnostics };
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
