/* Legacy (graph-model) library import — a PURE module (no runes / DOM / global storage), spec
   "Persistence, files and import" + S05 §5.

   `detectLegacyLibrary` finds old-format data: the v1/v2 show library or the older single
   authored blob under the OLD localStorage keys, or the server's old-version blob delivered in
   `state`. `importLegacyShows` projects it into v3 shows: each show keeps its id (unless it
   collides), name, songs and sections (ids, names, order, bars, bpm), songRefs, canvasScenes,
   transport (bpm / beatsPerBar / velocity) and pane sizes. Graphs, presets, buses and effect defs
   are dropped, so every section has an empty grid and no master chain. The referenced legacy song
   library comes across the same way, so `songRefs` keep resolving.

   This is the ONE place the old formats are still read (the graph model is gone everywhere else,
   effect chains S08), so their envelope gates and the defensive field coercion live here. Only
   the fields an import keeps are read; the graph containers are never looked at, which also makes
   the old v1 hoop-id migration moot (it only ever rewrote graph nodes). Nothing here writes: the
   old data stays in place and the caller persists the returned v3 library under the new keys.

   Idempotent: an imported show records `importedFrom: <source show id>`; a re-import skips any
   source show already imported, and a library song whose id is already in the v3 pool is kept as
   is. */

import { SHOWS_PRIOR_VERSION, SHOWS_VERSION, SONGS_VERSION, type CanvasScene } from '@ledrums/core';
import {
  readStoredJson,
  type AuthoredStateV3,
  type EffectLibrarySong,
  type EffectSection,
  type EffectSong,
  type ShowLibraryV3,
  type ShowV3,
  type SongLibraryV2,
  type StorageLike,
} from './persistence';
import { nid } from './store/ids';

// ---- the old formats (read-only) ------------------------------------------------------------

/** The old single authored blob's localStorage key (pre show-library). */
export const STORAGE_KEY = 'ledrums:authored:v1';
/** The old (v1/v2) show library's localStorage key. */
export const SHOWS_STORAGE_KEY = 'ledrums:shows:v1';
/** The old (v1) song library's localStorage key. */
export const SONGS_STORAGE_KEY = 'ledrums:songs:v1';

/** The single authored blob's envelope versions: v2, and the v1 it upgraded from. */
const AUTHORED_VERSION = 2;
const AUTHORED_PRIOR_VERSION = 1;

/** One old section, as far as an import reads it. */
interface LegacySection {
  id: string;
  name: string;
}

interface LegacySong {
  id: string;
  name: string;
  sections: LegacySection[];
}

/** The fields of an old authored slice an import keeps (every one optional: a partially-corrupt
    slice degrades to what survived). */
interface LegacyAuthored {
  songs?: LegacySong[];
  songRefs?: string[];
  canvasScenes?: CanvasScene[];
  activeSongId?: string;
  activeSectionId?: string | null;
  bpm?: number;
  velocity?: number;
  beatsPerBar?: number;
  paneSizes?: Record<string, number>;
  patchLabels?: Record<string, string>;
}

interface LegacyShow {
  id: string;
  name: string;
  authored: LegacyAuthored;
}

interface LegacyShowLibrary {
  shows: Record<string, LegacyShow>;
  activeShowId: string;
}

interface LegacySongLibrary {
  songs: Record<string, LegacySong>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** De-duplicate the string entries of an unknown array, preserving first-appearance order. */
function dedupeStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Old songs, defensively: non-object songs / sections are skipped, ids and names coerced. */
function coerceLegacySongs(songs: readonly unknown[]): LegacySong[] {
  const out: LegacySong[] = [];
  for (const raw of songs) {
    if (!isObject(raw)) continue;
    const sections: LegacySection[] = [];
    for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
      if (isObject(sec)) sections.push({ id: String(sec.id ?? ''), name: String(sec.name ?? '') });
    }
    out.push({ id: String(raw.id ?? ''), name: String(raw.name ?? ''), sections });
  }
  return out;
}

/** Keep section ids globally unique across `songs` (the first section with an id wins; id-less
    sections are dropped). */
function uniqueSectionIds(songs: readonly LegacySong[], reserved: Set<string>): LegacySong[] {
  return songs.map((song) => ({
    ...song,
    sections: song.sections.filter((section) => {
      if (!section.id || reserved.has(section.id)) return false;
      reserved.add(section.id);
      return true;
    }),
  }));
}

/** Field-level coercion of an old authored slice (only the fields an import keeps). */
function coerceLegacyAuthored(data: unknown): LegacyAuthored {
  if (!isObject(data)) return {};
  const out: LegacyAuthored = {};
  if (Array.isArray(data.songs)) out.songs = uniqueSectionIds(coerceLegacySongs(data.songs), new Set());
  if (Array.isArray(data.songRefs)) out.songRefs = dedupeStrings(data.songRefs);
  if (Array.isArray(data.canvasScenes)) out.canvasScenes = data.canvasScenes as CanvasScene[];
  if (isObject(data.paneSizes)) out.paneSizes = data.paneSizes as Record<string, number>;
  if (isObject(data.patchLabels)) out.patchLabels = data.patchLabels as Record<string, string>;
  if (typeof data.activeSongId === 'string') out.activeSongId = data.activeSongId;
  // An older blob stored the active section under `arrangeSectionId`.
  const rawActiveSection = data.activeSectionId !== undefined ? data.activeSectionId : data.arrangeSectionId;
  if (typeof rawActiveSection === 'string' || rawActiveSection === null) out.activeSectionId = rawActiveSection;
  if (isFiniteNumber(data.bpm)) out.bpm = data.bpm;
  if (isFiniteNumber(data.velocity)) out.velocity = data.velocity;
  if (isFiniteNumber(data.beatsPerBar)) out.beatsPerBar = data.beatsPerBar;
  return out;
}

/** The old single authored-blob envelope (v1 or v2), or null. */
function readLegacyAuthoredBlob(raw: unknown): LegacyAuthored | null {
  if (!isObject(raw)) return null;
  if (raw.version !== AUTHORED_VERSION && raw.version !== AUTHORED_PRIOR_VERSION) return null;
  if (!isObject(raw.data)) return null;
  return coerceLegacyAuthored(raw.data);
}

/** The old show-library envelope (v1 or v2), or null when unusable or no show survives. Section
    ids stay unique across the whole library (first wins). */
function readLegacyShowLibrary(raw: unknown): LegacyShowLibrary | null {
  if (!isObject(raw)) return null;
  if (raw.version !== SHOWS_VERSION && raw.version !== SHOWS_PRIOR_VERSION) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.shows)) return null;
  const shows: Record<string, LegacyShow> = {};
  for (const [id, rawShow] of Object.entries(data.shows)) {
    if (!isObject(rawShow)) continue;
    const showId = typeof rawShow.id === 'string' && rawShow.id ? rawShow.id : id;
    const name = typeof rawShow.name === 'string' && rawShow.name ? rawShow.name : 'Untitled Show';
    shows[showId] = { id: showId, name, authored: coerceLegacyAuthored(rawShow.authored) };
  }
  if (Object.keys(shows).length === 0) return null;
  const usedSectionIds = new Set<string>();
  for (const show of Object.values(shows)) {
    if (show.authored.songs) show.authored.songs = uniqueSectionIds(show.authored.songs, usedSectionIds);
  }
  const activeShowId =
    typeof data.activeShowId === 'string' && shows[data.activeShowId] ? data.activeShowId : Object.keys(shows)[0]!;
  return { shows, activeShowId };
}

/** The old (v1) song-library envelope, or null when unusable. An empty pool is legal. */
function readLegacySongLibrary(raw: unknown): LegacySongLibrary | null {
  if (!isObject(raw) || raw.version !== SONGS_VERSION) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.songs)) return null;
  const songs: Record<string, LegacySong> = {};
  const usedSectionIds = new Set<string>();
  for (const rawSong of Object.values(data.songs)) {
    if (!isObject(rawSong) || typeof rawSong.id !== 'string' || !rawSong.id) continue;
    const [song] = uniqueSectionIds(coerceLegacySongs([{ id: rawSong.id, name: rawSong.name, sections: rawSong.sections }]), usedSectionIds);
    songs[rawSong.id] = { id: rawSong.id, name: typeof rawSong.name === 'string' && rawSong.name ? rawSong.name : 'Untitled Song', sections: song?.sections ?? [] };
  }
  return { songs };
}

// ---- detect + import ------------------------------------------------------------------------

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

/** Parse an old show source into the old library shape, or null. */
function parseLegacyShows(raw: unknown): LegacyShowLibrary | null {
  const lib = readLegacyShowLibrary(raw);
  if (lib) return lib;
  const single = readLegacyAuthoredBlob(raw);
  if (!single) return null;
  return {
    shows: { [LEGACY_SINGLE_SHOW_ID]: { id: LEGACY_SINGLE_SHOW_ID, name: 'Default Show', authored: single } },
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

  const legacySongs = raw.songs == null ? null : readLegacySongLibrary(raw.songs);
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
  legacyAuthored: LegacyAuthored,
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

/** `bars` / `bpm` as the raw source stored them (the old coercion does not carry them). */
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
