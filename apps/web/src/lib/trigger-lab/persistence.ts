/* Live persistence for AUTHORED state — a PURE module (no runes, no DOM) so the
   serialize/deserialize contract + its version gate are unit-testable in node, like
   setlist / shell-nav / show-builder. The store (store.svelte.ts) owns the localStorage I/O and
   the reactive autosave; this module only knows the persisted shape + the versioned envelope.

   Deserialize never throws and returns null on an unusable envelope (so a stale/corrupt payload
   can never wedge boot — the store keeps its seed); otherwise a PARTIAL slice carrying only the
   fields that were present and well-typed, which the store merges over its seed defaults. The
   old graph-model libraries (v1/v2 show library, v1 song library, the single authored blob) are
   never read here: `legacy-import.ts` offers them for import. */

import { SHOWS_VERSION_EFFECTS, SONGS_VERSION_EFFECTS, effectChain, type CanvasScene } from '@ledrums/core';
import { MASTER_CELL, type CellSelection } from './effects-api';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Write `key` as an OWN data property. Ids come from stored / server-relayed JSON, and a plain
    assignment of `__proto__` would re-point the record's prototype instead of adding an entry. */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

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

// ---- effect chains: v3 show library + v2 song library ---------------------------------------

/* The effect-chains authored model (spec "Persistence, files and import"). Sections carry an
   ordered `effects` stack + a `master` modifier chain; the show keeps songs, songRefs,
   canvasScenes, transport and pane sizes. These live under NEW storage keys with NEW envelope
   versions — the old keys are never written or deleted (the old data stays in place for import,
   `legacy-import.ts`). The persisted shape is the one core's `effectChain.parseShowLibraryV3` /
   `buildRuntimeShow` read, so the server projects the same Show from the same blob. */

type Effect = effectChain.Effect;
type ModifierDevice = effectChain.ModifierDevice;

/** localStorage key for the v3 (effect-chains) show library. */
export const SHOWS_V3_STORAGE_KEY = 'ledrums:shows:v3';
/** localStorage key for the v2 (effect-chains) song library. */
export const SONGS_V2_STORAGE_KEY = 'ledrums:songs:v2';

/** The storage surface the v3 read/write helpers need — injected so they stay IO-free in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** An effect-chains section: its Effect stack (composition order) and master chain. */
export interface EffectSection {
  id: string;
  name: string;
  bars?: number;
  bpm?: number;
  effects: Effect[];
  master: ModifierDevice[];
  /** Sequence / Random cells (absent = every cell layers). */
  cellPlay?: effectChain.CellPlay[];
}

export interface EffectSong {
  id: string;
  name: string;
  sections: EffectSection[];
}

/** The persisted per-show authored slice (v3). Transient state never lives here. */
export interface AuthoredStateV3 {
  songs: EffectSong[];
  /** Ids into the song library, as an ordered set. */
  songRefs?: string[];
  canvasScenes?: CanvasScene[];
  /** The selected grid cell (or the Master cell). */
  selectedCell: CellSelection | null;
  selectedEffectId: string | null;
  activeSongId: string;
  activeSectionId: string | null;
  bpm: number;
  velocity: number;
  beatsPerBar: number;
  paneSizes?: Record<string, number>;
  patchLabels?: Record<string, string>;
  /** MIDI-map mappings — opaque until effect-chains S07a gives them a shape. */
  mappings?: unknown;
}

export interface ShowV3 {
  id: string;
  name: string;
  authored: AuthoredStateV3;
  /** The old-format show id this show was imported from (`legacy-import.ts`) — makes re-import
      idempotent. Absent on shows authored in v3. */
  importedFrom?: string;
}

export interface ShowLibraryV3 {
  shows: Record<string, ShowV3>;
  activeShowId: string;
}

export interface PersistedShowLibraryV3 {
  version: typeof SHOWS_VERSION_EFFECTS;
  data: ShowLibraryV3;
}

/** A canonical library song (v2 song library): its effect sections and the scenes they use. */
export interface EffectLibrarySong extends EffectSong {
  canvasScenes?: CanvasScene[];
}

export interface SongLibraryV2 {
  songs: Record<string, EffectLibrarySong>;
}

export interface PersistedSongLibraryV2 {
  version: typeof SONGS_VERSION_EFFECTS;
  data: SongLibraryV2;
}

export function serializeShowLibraryV3(lib: ShowLibraryV3): PersistedShowLibraryV3 {
  return { version: SHOWS_VERSION_EFFECTS, data: lib };
}

export function serializeSongLibraryV2(lib: SongLibraryV2): PersistedSongLibraryV2 {
  return { version: SONGS_VERSION_EFFECTS, data: lib };
}

/** Parse each Effect on its own; an invalid or duplicate-id one is dropped (the rest survive). */
function coerceEffects(raw: unknown): Effect[] {
  if (!Array.isArray(raw)) return [];
  const out: Effect[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const parsed = effectChain.effectSchema.safeParse(entry);
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out;
}

function coerceMaster(raw: unknown): ModifierDevice[] {
  if (!Array.isArray(raw)) return [];
  const out: ModifierDevice[] = [];
  for (const entry of raw) {
    const parsed = effectChain.modifierDeviceSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** One v3 section, or null when it has no usable id. */
function coerceEffectSection(raw: unknown): EffectSection | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const section: EffectSection = {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    effects: coerceEffects(raw.effects),
    master: coerceMaster(raw.master),
  };
  if (isFiniteNumber(raw.bars)) section.bars = raw.bars;
  if (isFiniteNumber(raw.bpm)) section.bpm = raw.bpm;
  // Settings, not content: an unreadable entry is dropped (that cell layers), never the section.
  if (Array.isArray(raw.cellPlay)) {
    const cellPlay = raw.cellPlay.flatMap((entry) => {
      const parsed = effectChain.cellPlaySchema.safeParse(entry);
      return parsed.success && parsed.data.mode !== 'layer' ? [parsed.data] : [];
    });
    if (cellPlay.length > 0) section.cellPlay = cellPlay;
  }
  return section;
}

/** Sections with globally unique ids (first wins). */
function coerceSections(raw: unknown, usedSectionIds: Set<string>): EffectSection[] {
  if (!Array.isArray(raw)) return [];
  const out: EffectSection[] = [];
  for (const entry of raw) {
    const section = coerceEffectSection(entry);
    if (!section || usedSectionIds.has(section.id)) continue;
    usedSectionIds.add(section.id);
    out.push(section);
  }
  return out;
}

function coerceEffectSongs(raw: readonly unknown[], usedSectionIds: Set<string>): EffectSong[] {
  const out: EffectSong[] = [];
  for (const song of raw) {
    if (!isObject(song) || typeof song.id !== 'string' || !song.id) continue;
    out.push({ id: song.id, name: typeof song.name === 'string' ? song.name : '', sections: coerceSections(song.sections, usedSectionIds) });
  }
  return out;
}

/** `null`, the Master cell, a valid cell — or `undefined` when malformed (the field is dropped). */
function coerceCellSelection(raw: unknown): CellSelection | null | undefined {
  if (raw === null) return null;
  if (raw === MASTER_CELL) return MASTER_CELL;
  const parsed = effectChain.effectCellSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Field-level coercion of a v3 authored slice: each
 * field is included only when present and well-typed, so a partially-corrupt slice degrades to
 * what survived. Effects / master modifiers are validated one by one with core's schemas (an
 * invalid one is dropped, the section survives). The store applies the result over its seed
 * defaults. `usedSectionIds` carries the cross-show section-id uniqueness set.
 */
export function coerceAuthoredV3(data: unknown, usedSectionIds = new Set<string>()): Partial<AuthoredStateV3> {
  if (!isObject(data)) return {};
  const out: Partial<AuthoredStateV3> = {};
  if (Array.isArray(data.songs)) out.songs = coerceEffectSongs(data.songs, usedSectionIds);
  if (Array.isArray(data.songRefs)) out.songRefs = dedupeStrings(data.songRefs);
  if (Array.isArray(data.canvasScenes)) out.canvasScenes = data.canvasScenes as CanvasScene[];
  if (isObject(data.paneSizes)) out.paneSizes = data.paneSizes as Record<string, number>;
  if (isObject(data.patchLabels)) out.patchLabels = data.patchLabels as Record<string, string>;
  if (data.mappings !== undefined) out.mappings = data.mappings;
  const cell = coerceCellSelection(data.selectedCell);
  if (cell !== undefined) out.selectedCell = cell;
  if (typeof data.selectedEffectId === 'string' || data.selectedEffectId === null) out.selectedEffectId = data.selectedEffectId;
  if (typeof data.activeSongId === 'string') out.activeSongId = data.activeSongId;
  if (typeof data.activeSectionId === 'string' || data.activeSectionId === null) out.activeSectionId = data.activeSectionId;
  if (isFiniteNumber(data.bpm)) out.bpm = data.bpm;
  if (isFiniteNumber(data.velocity)) out.velocity = data.velocity;
  if (isFiniteNumber(data.beatsPerBar)) out.beatsPerBar = data.beatsPerBar;
  return out;
}

/**
 * Validate a parsed v3 library blob. Null when the envelope is unusable: not an object, a version
 * other than `SHOWS_VERSION_EFFECTS` (an old v1/v2 blob is NOT upgraded here — that is the import
 * path), no `shows` record, or zero surviving shows. Per show: malformed shows are dropped,
 * `authored` is coerced field by field, and a dangling `activeShowId` re-points to the first
 * show. The authored slice may be partial (the store fills defaults).
 */
export function deserializeShowLibraryV3(raw: unknown): ShowLibraryV3 | null {
  if (!isObject(raw) || raw.version !== SHOWS_VERSION_EFFECTS) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.shows)) return null;
  const usedSectionIds = new Set<string>();
  const shows: Record<string, ShowV3> = {};
  for (const [id, rawShow] of Object.entries(data.shows)) {
    if (!isObject(rawShow)) continue;
    const showId = typeof rawShow.id === 'string' && rawShow.id ? rawShow.id : id;
    const name = typeof rawShow.name === 'string' && rawShow.name ? rawShow.name : 'Untitled Show';
    // Partial-as-full cast: the store merges the slice over its seed defaults.
    const show: ShowV3 = { id: showId, name, authored: coerceAuthoredV3(rawShow.authored, usedSectionIds) as AuthoredStateV3 };
    if (typeof rawShow.importedFrom === 'string' && rawShow.importedFrom) show.importedFrom = rawShow.importedFrom;
    setOwn(shows, showId, show);
  }
  if (Object.keys(shows).length === 0) return null;
  const activeShowId =
    typeof data.activeShowId === 'string' && shows[data.activeShowId] ? data.activeShowId : Object.keys(shows)[0]!;
  return { shows, activeShowId };
}

/**
 * The boot v3 library: a valid v3 blob, else a fresh library holding one show seeded by `seed`
 * (`seed-effects.ts`). Never reads or migrates the old keys — an old library is offered for import
 * instead. Pure, never throws; `newId` mints the fresh show's id.
 */
export function loadShowLibraryV3(rawV3: unknown, newId: () => string, seed: () => AuthoredStateV3): ShowLibraryV3 {
  const lib = deserializeShowLibraryV3(rawV3);
  if (lib) return lib;
  const id = newId();
  return { shows: { [id]: { id, name: 'Untitled Show', authored: seed() } }, activeShowId: id };
}

/** Validate a v2 song-library blob; null when the envelope is unusable. An empty pool is legal. */
export function deserializeSongLibraryV2(raw: unknown): SongLibraryV2 | null {
  if (!isObject(raw) || raw.version !== SONGS_VERSION_EFFECTS) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.songs)) return null;
  const usedSectionIds = new Set<string>();
  const songs: Record<string, EffectLibrarySong> = {};
  for (const rawSong of Object.values(data.songs)) {
    if (!isObject(rawSong) || typeof rawSong.id !== 'string' || !rawSong.id) continue;
    const song: EffectLibrarySong = {
      id: rawSong.id,
      name: typeof rawSong.name === 'string' && rawSong.name ? rawSong.name : 'Untitled Song',
      sections: coerceSections(rawSong.sections, usedSectionIds),
    };
    if (Array.isArray(rawSong.canvasScenes)) song.canvasScenes = rawSong.canvasScenes as CanvasScene[];
    setOwn(songs, song.id, song);
  }
  return { songs };
}

/** The boot v2 song library: a valid blob, else a fresh empty pool. */
export function loadSongLibraryV2(raw: unknown): SongLibraryV2 {
  return deserializeSongLibraryV2(raw) ?? { songs: {} };
}

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const s = storage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike, key: string, payload: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Read + parse a storage key; null on a missing key, malformed JSON or a throwing storage. */
export function readStoredJson(storage: StorageLike, key: string): unknown {
  return readJson(storage, key);
}

/** Write the v3 show library to {@link SHOWS_V3_STORAGE_KEY} only. False on quota / private mode. */
export function writeShowLibraryV3(storage: StorageLike, lib: ShowLibraryV3): boolean {
  return writeJson(storage, SHOWS_V3_STORAGE_KEY, serializeShowLibraryV3(lib));
}

/** Write the v2 song library to {@link SONGS_V2_STORAGE_KEY} only. False on quota / private mode. */
export function writeSongLibraryV2(storage: StorageLike, lib: SongLibraryV2): boolean {
  return writeJson(storage, SONGS_V2_STORAGE_KEY, serializeSongLibraryV2(lib));
}

/**
 * Boot both effect-chains libraries from storage, reading ONLY the new keys. Returns whether each
 * came from real stored content (the store's local-wins-over-server signal).
 */
export function bootEffectLibraries(
  storage: StorageLike | null,
  newId: () => string,
  seed: () => AuthoredStateV3,
): { shows: ShowLibraryV3; songs: SongLibraryV2; showsFromStorage: boolean; songsFromStorage: boolean } {
  const rawShows = storage ? readJson(storage, SHOWS_V3_STORAGE_KEY) : null;
  const rawSongs = storage ? readJson(storage, SONGS_V2_STORAGE_KEY) : null;
  return {
    shows: loadShowLibraryV3(rawShows, newId, seed),
    songs: loadSongLibraryV2(rawSongs),
    showsFromStorage: deserializeShowLibraryV3(rawShows) !== null,
    songsFromStorage: deserializeSongLibraryV2(rawSongs) !== null,
  };
}
