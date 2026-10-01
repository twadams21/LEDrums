/* Legacy (graph-model) library import — a PURE module (no runes / DOM / global storage), spec
   "Persistence, files and import" + S05 §5.

   `detectLegacyLibrary` finds old-format data: the v1/v2 show library or the older single
   authored blob under the OLD localStorage keys, or the server's old-version blob delivered in
   `state`. `importLegacyShows` projects it into v3 shows: each show keeps its id (unless it
   collides), name, songs and sections (ids, names, order, bars, bpm), songRefs, canvasScenes,
   transport (bpm / beatsPerBar / velocity) and pane sizes. Graphs, presets, buses and effect defs
   are dropped, so every section has an empty grid and no master chain. The referenced legacy song
   library comes across the same way, so `songRefs` keep resolving.

   Parsing goes through the EXISTING v2 loaders (`deserializeShowLibrary` / `deserializeAuthored`
   / `deserializeSongLibrary`), so a v1 source gets the existing hoop-id migration and every
   defensive coercion exactly as a v2 boot would. Nothing here writes: the old data stays in place
   and the caller persists the returned v3 library under the new keys.

   Idempotent: an imported show records `importedFrom: <source show id>`; a re-import skips any
   source show already imported, and a library song whose id is already in the v3 pool is kept as
   is. */

import {
  SHOWS_STORAGE_KEY,
  SHOWS_VERSION,
  SHOWS_PRIOR_VERSION,
  SONGS_STORAGE_KEY,
  SONGS_VERSION,
  STORAGE_KEY,
  deserializeAuthored,
  deserializeShowLibrary,
  deserializeSongLibrary,
  readStoredJson,
  type AuthoredState,
  type AuthoredStateV3,
  type EffectLibrarySong,
  type EffectSection,
  type EffectSong,
  type ShowLibrary,
  type ShowLibraryV3,
  type ShowV3,
  type SongLibraryV2,
  type StorageLike,
} from './persistence';
import { nid } from './store/ids';

/** The source id given to a legacy single authored blob (it has no show id of its own). Fixed so
    a re-import of the same blob is recognised. */
export const LEGACY_SINGLE_SHOW_ID = 'legacy-default-show';

/** Old-format data found at boot, raw (never mutated). */
export interface LegacyLibrary {
  source: 'local' | 'server';
  /** A v1/v2 show-library envelope, or a legacy single authored-state envelope. */
  shows: unknown;
  /** The v1 song-library envelope from the same source, when one exists. */
  songs: unknown;
  /** Names of every show in the old library, in library order. */
  showNames: string[];
}

/** The server's library blobs as delivered in `state` (either may be absent / null). */
export interface ServerLibraryBlobs {
  showLibrary?: unknown;
  songLibrary?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse an old show source into the v2 library shape (hoop-migrated when v1), or null. */
function parseLegacyShows(raw: unknown): ShowLibrary | null {
  const lib = deserializeShowLibrary(raw);
  if (lib) return lib;
  const single = deserializeAuthored(raw);
  if (!single) return null;
  return {
    shows: { [LEGACY_SINGLE_SHOW_ID]: { id: LEGACY_SINGLE_SHOW_ID, name: 'Default Show', authored: single as AuthoredState } },
    activeShowId: LEGACY_SINGLE_SHOW_ID,
  };
}

/** A server blob is legacy only when it carries an old show-library version. */
function isLegacyServerShows(raw: unknown): boolean {
  return isObject(raw) && (raw.version === SHOWS_VERSION || raw.version === SHOWS_PRIOR_VERSION);
}

function isLegacySongs(raw: unknown): boolean {
  return isObject(raw) && raw.version === SONGS_VERSION;
}

/**
 * Find an old-format library. Local storage wins over the server (it is the freshest copy, the
 * same local-wins rule the v2 boot uses): the old show library, else the old single authored
 * blob. Otherwise the server's blob when it is an old version. Null when there is nothing to
 * import. Reads only; never throws (a throwing / missing storage counts as empty).
 */
export function detectLegacyLibrary(storage: StorageLike | null, server?: ServerLibraryBlobs | null): LegacyLibrary | null {
  const localLib = storage ? readStoredJson(storage, SHOWS_STORAGE_KEY) : null;
  const localSingle = storage ? readStoredJson(storage, STORAGE_KEY) : null;
  const localShows = parseLegacyShows(localLib) ? localLib : parseLegacyShows(localSingle) ? localSingle : null;
  if (localShows !== null) {
    const localSongs = storage ? readStoredJson(storage, SONGS_STORAGE_KEY) : null;
    return legacy('local', localShows, isLegacySongs(localSongs) ? localSongs : null);
  }
  const serverShows = server?.showLibrary;
  if (isLegacyServerShows(serverShows) && parseLegacyShows(serverShows)) {
    const serverSongs = server?.songLibrary;
    return legacy('server', serverShows, isLegacySongs(serverSongs) ? serverSongs : null);
  }
  return null;
}

function legacy(source: LegacyLibrary['source'], shows: unknown, songs: unknown): LegacyLibrary {
  const lib = parseLegacyShows(shows)!;
  return { source, shows, songs, showNames: Object.values(lib.shows).map((s) => s.name) };
}

/** Names of the legacy shows an import into `into` would still bring across (already-imported
    shows excluded) — empty means there is nothing left to import. */
export function pendingLegacyShowNames(legacyLib: Pick<LegacyLibrary, 'shows'>, into: ShowLibraryV3 | null): string[] {
  const lib = parseLegacyShows(legacyLib.shows);
  if (!lib) return [];
  const imported = importedSourceIds(into);
  return Object.values(lib.shows).filter((s) => !imported.has(s.id)).map((s) => s.name);
}

function importedSourceIds(into: ShowLibraryV3 | null): Set<string> {
  return new Set(Object.values(into?.shows ?? {}).flatMap((s) => (s.importedFrom ? [s.importedFrom] : [])));
}

export interface LegacyImportResult {
  /** `into` plus the imported shows (its `activeShowId` is kept; with no `into`, the legacy
      library's active show). */
  library: ShowLibraryV3;
  /** `intoSongs` plus the imported library songs. */
  songLibrary: SongLibraryV2;
  /** The v3 ids of the shows this call imported, in legacy library order. */
  importedShowIds: string[];
}

export interface LegacyImportOptions {
  /** The current v3 library to import into (its shows are never changed). */
  into?: ShowLibraryV3 | null;
  intoSongs?: SongLibraryV2 | null;
  /** Mints an id when a source show / section id collides. Defaults to the store's id factory. */
  newId?: (prefix: 'show' | 'section') => string;
}

/**
 * Project an old library into v3 shows (see the module header for what is kept and dropped).
 * Pure: the inputs are not mutated. An unusable source imports nothing (`importedShowIds` empty).
 * Section ids stay globally unique across the resulting library: a legacy section keeps its id
 * unless another show already uses it, in which case it gets a fresh id (and a pointing
 * `activeSectionId` follows it).
 */
export function importLegacyShows(
  raw: Pick<LegacyLibrary, 'shows' | 'songs'>,
  options: LegacyImportOptions = {},
): LegacyImportResult {
  const into = options.into ?? null;
  const newId = options.newId ?? ((prefix) => nid(prefix));
  const shows: Record<string, ShowV3> = { ...(into?.shows ?? {}) };
  const songs: Record<string, EffectLibrarySong> = { ...(options.intoSongs?.songs ?? {}) };
  const importedShowIds: string[] = [];
  const importedIdOf = new Map<string, string>();

  const legacyShows = parseLegacyShows(raw.shows);
  const rawSections = rawSectionIndex(raw.shows);
  const usedSectionIds = new Set(Object.values(shows).flatMap((s) => sectionIds(s.authored.songs ?? [])));
  const freshSectionId = (): string => {
    let id = newId('section');
    while (usedSectionIds.has(id)) id = newId('section');
    return id;
  };

  const already = importedSourceIds(into);
  for (const legacyShow of Object.values(legacyShows?.shows ?? {})) {
    if (already.has(legacyShow.id)) continue;
    let id = legacyShow.id;
    while (shows[id]) id = newId('show');
    const renamed = new Map<string, string>();
    const authored = projectAuthored(legacyShow.authored, (sectionId) => {
      let next = sectionId;
      if (usedSectionIds.has(next)) {
        next = freshSectionId();
        renamed.set(sectionId, next);
      }
      usedSectionIds.add(next);
      return { id: next, ...sectionTiming(rawSections.get(sectionId)) };
    });
    if (authored.activeSectionId && renamed.has(authored.activeSectionId)) {
      authored.activeSectionId = renamed.get(authored.activeSectionId)!;
    }
    shows[id] = { id, name: legacyShow.name, authored, importedFrom: legacyShow.id };
    importedShowIds.push(id);
    importedIdOf.set(legacyShow.id, id);
  }

  const legacySongs = raw.songs == null ? null : deserializeSongLibrary(raw.songs);
  for (const song of Object.values(legacySongs?.songs ?? {})) {
    if (songs[song.id]) continue;
    songs[song.id] = {
      id: song.id,
      name: song.name,
      sections: song.sections.map((s) => emptySection(s.id, s.name)),
    };
  }

  // The current library keeps its active show; importing into nothing opens the legacy active one.
  const legacyActive = legacyShows ? importedIdOf.get(legacyShows.activeShowId) : undefined;
  const activeShowId = into?.activeShowId && shows[into.activeShowId]
    ? into.activeShowId
    : (legacyActive ?? importedShowIds[0] ?? Object.keys(shows)[0] ?? '');
  return { library: { shows, activeShowId }, songLibrary: { songs }, importedShowIds };
}

function emptySection(id: string, name: string, timing: Pick<EffectSection, 'bars' | 'bpm'> = {}): EffectSection {
  return { id, name, ...timing, effects: [], master: [] };
}

function sectionIds(songs: readonly EffectSong[]): string[] {
  return songs.flatMap((song) => song.sections.map((s) => s.id));
}

/** The v3 authored slice for one legacy show. `placeSection` assigns the section's final id and
    carries its raw timing fields. */
function projectAuthored(
  legacyAuthored: Partial<AuthoredState>,
  placeSection: (sectionId: string) => Pick<EffectSection, 'id' | 'bars' | 'bpm'>,
): AuthoredStateV3 {
  const songs: EffectSong[] = (legacyAuthored.songs ?? []).map((song) => ({
    id: song.id,
    name: song.name,
    sections: song.sections.map((section) => {
      const { id, ...timing } = placeSection(section.id);
      return emptySection(id, section.name, timing);
    }),
  }));
  const activeSongId = legacyAuthored.activeSongId && songs.some((s) => s.id === legacyAuthored.activeSongId)
    ? legacyAuthored.activeSongId
    : (songs[0]?.id ?? '');
  const authored: AuthoredStateV3 = {
    songs,
    songRefs: [...(legacyAuthored.songRefs ?? [])],
    canvasScenes: structuredClone(legacyAuthored.canvasScenes ?? []),
    selectedCell: null,
    selectedEffectId: null,
    activeSongId,
    activeSectionId: legacyAuthored.activeSectionId ?? null,
    bpm: legacyAuthored.bpm ?? 120,
    velocity: legacyAuthored.velocity ?? 0.85,
    beatsPerBar: legacyAuthored.beatsPerBar ?? 4,
    paneSizes: { ...(legacyAuthored.paneSizes ?? {}) },
    patchLabels: { ...(legacyAuthored.patchLabels ?? {}) },
  };
  // A pointer at a section the source doesn't have would dangle. It is checked against the SOURCE
  // ids; a renamed section's pointer is re-pointed by the caller.
  const sourceIds = new Set((legacyAuthored.songs ?? []).flatMap((s) => s.sections.map((x) => x.id)));
  if (authored.activeSectionId && !sourceIds.has(authored.activeSectionId)) authored.activeSectionId = null;
  return authored;
}

/** `bars` / `bpm` as the raw source stored them (the v2 coercion does not carry them). */
function sectionTiming(raw: Record<string, unknown> | undefined): Pick<EffectSection, 'bars' | 'bpm'> {
  const out: Pick<EffectSection, 'bars' | 'bpm'> = {};
  if (typeof raw?.bars === 'number' && Number.isFinite(raw.bars)) out.bars = raw.bars;
  if (typeof raw?.bpm === 'number' && Number.isFinite(raw.bpm)) out.bpm = raw.bpm;
  return out;
}

/** Index the raw source's sections by id (first occurrence wins), library or single-blob shape. */
function rawSectionIndex(raw: unknown): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  if (!isObject(raw) || !isObject(raw.data)) return index;
  const authoreds = isObject(raw.data.shows)
    ? Object.values(raw.data.shows).map((show) => (isObject(show) ? show.authored : undefined))
    : [raw.data];
  for (const authored of authoreds) {
    if (!isObject(authored) || !Array.isArray(authored.songs)) continue;
    for (const song of authored.songs) {
      if (!isObject(song) || !Array.isArray(song.sections)) continue;
      for (const section of song.sections) {
        if (isObject(section) && typeof section.id === 'string' && !index.has(section.id)) index.set(section.id, section);
      }
    }
  }
  return index;
}
