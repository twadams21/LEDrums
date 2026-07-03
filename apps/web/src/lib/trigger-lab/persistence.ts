/* Live persistence for AUTHORED state — a PURE module (no runes, no DOM) so the
   serialize/deserialize contract + its version gate are unit-testable in node,
   like setlist / shell-nav / show-builder. The store (store.svelte.ts) owns the
   localStorage I/O + the reactive autosave; this module only knows the persisted
   shape + the versioned envelope.

   Contract: serializeAuthored wraps a slice in a versioned envelope.
   deserializeAuthored returns null on a version mismatch or a malformed blob (so
   a stale/corrupt payload can never wedge boot — the store keeps its seed), and
   otherwise a PARTIAL slice carrying only the fields that were present and
   well-typed. The store merges that over its seed defaults, so missing fields
   (older blob) and unknown fields (newer blob) are both tolerated without a
   version bump — bump VERSION only when an existing field changes incompatibly. */

import type { Bus, EffectDef, Preset, TriggerGraph } from './sim';
import type { SetlistSection, Song } from '../app/setlist';
import type { LibrarySong } from './store/song-library';

/** localStorage key — carries the schema version so old payloads are namespaced
    (a future v2 writes to a different key, leaving v1 untouched). */
export const STORAGE_KEY = 'ledrums:authored:v1';

/** Payload schema version. Bump only on an INCOMPATIBLE change to an existing
    field; additive fields are tolerated by deserialize without a bump. Older
    payloads then fail the version gate and are ignored (boot falls back to seed). */
export const VERSION = 1;

/** The persisted slice of the store — AUTHORED content only (never transient
    voice/frame/link/transport-playing state). */
export interface AuthoredState {
  graphs: Record<string, TriggerGraph>;
  /** human labels for AUTHORED graph keys (pad-derived graphs label from the kit).
      Kept beside `graphs` so a created graph keeps its name across reloads. */
  graphNames: Record<string, string>;
  songs: Song[];
  /** Library-song references (S41): ids into the {@link SongLibrary} pool this show resolves into
      its runtime view (canonical propagation — the closure lives in the library, not here). An
      ordered set. Tolerated when absent (older blobs / a show that references nothing). */
  songRefs?: string[];
  buses: Bus[];
  presets: Preset[];
  effects: EffectDef[];
  selectedPadKey: string | null;
  activeSongId: string;
  /** The active section — the one you're playing AND editing (U4 merged the old
      `activeSectionId`/`arrangeSectionId`). Older blobs carry the field under
      `arrangeSectionId`; {@link deserializeAuthored} reads either. */
  activeSectionId: string | null;
  bpm: number;
  velocity: number;
  beatsPerBar: number;
  /** Persisted shell pane sizes in px (keyed by a stable pane id) — added for the
      resizable docks (step 3); tolerated when absent so older blobs still load. */
  paneSizes?: Record<string, number>;
  /** Per-node display-label overrides for the Patch graph, keyed by flow-node id —
      a UI-only rename (the device topology ids aren't server state), so it lives here
      beside the other authored prefs. Tolerated when absent (older blobs). */
  patchLabels?: Record<string, string>;
}

/** Versioned envelope written to storage. */
export interface PersistedAuthored {
  version: number;
  data: AuthoredState;
}

/** Wrap a slice in the versioned envelope (JSON-safe; the caller stringifies). */
export function serializeAuthored(state: AuthoredState): PersistedAuthored {
  return { version: VERSION, data: state };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a parsed blob and return the authored fields it carries. Returns null
 * only when the envelope itself is unusable (not an object, or a version other
 * than VERSION) — that is the "never wedge boot" gate. When the version matches,
 * each field is included only if it is present and the right container/primitive
 * type, so a partially-corrupt blob degrades to the fields that survived rather
 * than discarding everything.
 */
export function deserializeAuthored(raw: unknown): Partial<AuthoredState> | null {
  if (!isObject(raw)) return null;
  if (raw.version !== VERSION) return null;
  if (!isObject(raw.data)) return null;
  return coerceAuthored(raw.data);
}

/**
 * Field-level coercion of an authored slice — the body of {@link deserializeAuthored}
 * WITHOUT the versioned-envelope gate. Split out so the per-show `authored` payload inside
 * a {@link ShowLibrary} (stored bare, not separately enveloped) gets the SAME defensive
 * field-by-field validation + U4 song migration as the single-blob path. Returns `{}` for a
 * non-object; otherwise each field is included only when present and the right
 * container/primitive type, so a partially-corrupt slice degrades to what survived.
 */
export function coerceAuthored(data: unknown): Partial<AuthoredState> {
  if (!isObject(data)) return {};

  const out: Partial<AuthoredState> = {};

  // containers — included only when the expected shape (records vs arrays)
  if (isObject(data.graphs)) out.graphs = data.graphs as Record<string, TriggerGraph>;
  if (isObject(data.graphNames)) out.graphNames = data.graphNames as Record<string, string>;
  // Songs are MIGRATED on the way in: a blob saved before U4 carries per-pad slot grids;
  // migrateSongs flattens each section's `slots` into the flat `graphs` list (idempotent,
  // so a U4 blob is untouched). See migrateSongs / sectionGraphList.
  if (Array.isArray(data.songs)) out.songs = migrateSongs(data.songs);
  // songRefs (S41): a string-id set; keep only string entries, de-duplicated — a partially-corrupt
  // list degrades to the ids that survived. Absent → the field stays undefined (references nothing).
  if (Array.isArray(data.songRefs)) out.songRefs = dedupeStrings(data.songRefs);
  if (Array.isArray(data.buses)) out.buses = data.buses as Bus[];
  if (Array.isArray(data.presets)) out.presets = data.presets as Preset[];
  if (Array.isArray(data.effects)) out.effects = data.effects as EffectDef[];
  if (isObject(data.paneSizes)) out.paneSizes = data.paneSizes as Record<string, number>;
  if (isObject(data.patchLabels)) out.patchLabels = data.patchLabels as Record<string, string>;

  // scalars — typeof-gated; the nullable ids also accept an explicit null
  if (typeof data.selectedPadKey === 'string' || data.selectedPadKey === null) {
    out.selectedPadKey = data.selectedPadKey as string | null;
  }
  if (typeof data.activeSongId === 'string') out.activeSongId = data.activeSongId;
  // activeSectionId (U4 merged active+arrange). Back-compat: an older blob stored it under
  // `arrangeSectionId` — read that when the new key is absent so a returning user's focus
  // survives the rename. Either may be an explicit null.
  const rawActiveSection = data.activeSectionId !== undefined ? data.activeSectionId : data.arrangeSectionId;
  if (typeof rawActiveSection === 'string' || rawActiveSection === null) {
    out.activeSectionId = rawActiveSection;
  }
  if (isFiniteNumber(data.bpm)) out.bpm = data.bpm;
  if (isFiniteNumber(data.velocity)) out.velocity = data.velocity;
  if (isFiniteNumber(data.beatsPerBar)) out.beatsPerBar = data.beatsPerBar;

  return out;
}

// ---- U4 back-compat: per-pad slots → flat graph list ------------------------

/**
 * The flat U4 graph list for a persisted section. A pre-U4 section carries a per-pad
 * `slots` grid (`Record<padKey, (string|null)[]>`); flatten it by iterating pads in stored
 * order, each slot in order, collecting the non-null graph keys de-duplicated (first
 * occurrence wins) — so the order is "slot order across pads". A section already on the U4
 * `graphs` list is returned (de-duplicated) untouched-in-spirit, making this idempotent;
 * a malformed section yields `[]`. Same defensive back-fill spirit as the store's
 * unionTriggerSources / unionEffects.
 */
export function sectionGraphList(section: unknown): string[] {
  if (!isObject(section)) return [];
  if (Array.isArray(section.graphs)) return dedupeStrings(section.graphs);
  if (!isObject(section.slots)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slots of Object.values(section.slots)) {
    if (!Array.isArray(slots)) continue;
    for (const key of slots) {
      if (typeof key === 'string' && key && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

/**
 * Migrate persisted songs to the U4 flat-graph-list section model (see {@link
 * sectionGraphList}). Defensive: skips non-object songs/sections and coerces ids/names, so a
 * partially-corrupt blob degrades to what survived rather than wedging boot. Idempotent on a
 * blob that is already U4.
 */
export function migrateSongs(songs: readonly unknown[]): Song[] {
  const out: Song[] = [];
  for (const raw of songs) {
    if (!isObject(raw)) continue;
    const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
    const sections: SetlistSection[] = [];
    for (const sec of rawSections) {
      if (!isObject(sec)) continue;
      // `looks` (S16) is coerced defensively + defaults to `{}`: a pre-S16 section has no
      // looks field, so it loads with an empty map (== no looks == unchanged behaviour), and a
      // section that already carries looks round-trips untouched — the migration is idempotent.
      sections.push({
        id: String(sec.id ?? ''),
        name: String(sec.name ?? ''),
        graphs: sectionGraphList(sec),
        looks: coerceLooks(sec.looks),
      });
    }
    out.push({ id: String(raw.id ?? ''), name: String(raw.name ?? ''), sections });
  }
  return out;
}

/**
 * Coerce a persisted section's `looks` into a clean per-bus map (S16): a non-object → `{}`;
 * otherwise keep only the entries whose value is a string (an effect id) or `null` (None),
 * dropping anything else. Defensive + idempotent, matching {@link sectionGraphList}'s spirit —
 * a partially-corrupt looks blob degrades to the entries that survived.
 */
function coerceLooks(value: unknown): Record<string, string | null> {
  if (!isObject(value)) return {};
  const out: Record<string, string | null> = {};
  for (const [busId, effectId] of Object.entries(value)) {
    if (typeof effectId === 'string' || effectId === null) out[busId] = effectId;
  }
  return out;
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

// ---- show document model: a named, multi-show library -----------------------

/* A SHOW is the authored content ({@link AuthoredState}) given an identity. The library
   wraps every show by id plus an active-show pointer; the store's live authored runes mirror
   the ACTIVE show's `authored`, and autosave writes the active show back. The server `Project`
   (routing/geometry/output) is orthogonal — shows are authored-state documents only. This
   module owns the persisted shape + its versioned envelope + the boot migration; the store
   (store.svelte.ts) owns the localStorage I/O + the live runes + the show lifecycle API. */

/** localStorage key for the show library — supersedes the single-blob {@link STORAGE_KEY}
    (which is now read once, at boot, only to migrate a returning user's implicit work). */
export const SHOWS_STORAGE_KEY = 'ledrums:shows:v1';

/** Library schema version (independent of {@link VERSION}; same bump-only-on-incompatible
    rule). The per-show `authored` payload is validated field-by-field via {@link
    coerceAuthored}, so an additive authored field never needs a library bump. */
export const SHOWS_VERSION = 1;

/** A named show — the authored document given identity. `authored` is the SAME shape the
    single-blob path persists (reused, never duplicated). */
export interface Show {
  id: string;
  name: string;
  authored: AuthoredState;
}

/** The persisted library: every show by id + which one is active. */
export interface ShowLibrary {
  shows: Record<string, Show>;
  activeShowId: string;
}

/** Versioned envelope written to storage (mirrors {@link PersistedAuthored}). */
export interface PersistedShowLibrary {
  version: number;
  data: ShowLibrary;
}

/** Wrap a library in the versioned envelope (JSON-safe; the caller stringifies). */
export function serializeShowLibrary(lib: ShowLibrary): PersistedShowLibrary {
  return { version: SHOWS_VERSION, data: lib };
}

/**
 * Validate a parsed library blob. Returns null when the envelope is unusable — not an
 * object, a version other than SHOWS_VERSION, no `shows` record, or zero surviving shows —
 * so the caller falls back to migration / a fresh library (never wedges boot). Otherwise it
 * is defensive per show: malformed shows are dropped, each show's `authored` runs through
 * {@link coerceAuthored} (so legacy per-show payloads migrate exactly like the single blob),
 * and a dangling `activeShowId` is re-pointed to the first surviving show.
 */
export function deserializeShowLibrary(raw: unknown): ShowLibrary | null {
  if (!isObject(raw)) return null;
  if (raw.version !== SHOWS_VERSION) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.shows)) return null;

  const shows: Record<string, Show> = {};
  for (const [id, rawShow] of Object.entries(data.shows)) {
    if (!isObject(rawShow)) continue;
    const showId = typeof rawShow.id === 'string' && rawShow.id ? rawShow.id : id;
    const name = typeof rawShow.name === 'string' && rawShow.name ? rawShow.name : 'Untitled Show';
    // The store applies this over its seed defaults, so a partial (defensively-coerced)
    // authored slice is fine — the AuthoredState cast mirrors deserializeAuthored's contract.
    const authored = coerceAuthored(rawShow.authored) as AuthoredState;
    shows[showId] = { id: showId, name, authored };
  }
  if (Object.keys(shows).length === 0) return null; // all shows malformed → fall back

  const activeShowId =
    typeof data.activeShowId === 'string' && shows[data.activeShowId]
      ? data.activeShowId
      : Object.keys(shows)[0]!; // re-point a missing/dangling active pointer to the first show
  return { shows, activeShowId };
}

/**
 * Build the boot library from the two storage blobs. Pure, defensive, idempotent — never
 * throws:
 *  1. a valid library blob → that library (the steady state, so a re-run after migration is
 *     a no-op: the library wins and `newId` is never called again);
 *  2. else a legacy single {@link AuthoredState} blob → wrap it as one "Default Show", active
 *     (the one-time upgrade of a returning user's implicit work);
 *  3. else a fresh library with a single empty "Untitled Show".
 * `newId` is injected so the caller controls id minting (and tests stay deterministic).
 */
export function loadShowLibrary(rawLibrary: unknown, rawSingle: unknown, newId: () => string): ShowLibrary {
  const lib = deserializeShowLibrary(rawLibrary);
  if (lib) return lib;

  const id = newId();
  const migrated = deserializeAuthored(rawSingle); // legacy single blob → partial slice, or null
  if (migrated) {
    return { shows: { [id]: { id, name: 'Default Show', authored: migrated as AuthoredState } }, activeShowId: id };
  }
  // Empty authored — the store merges it over its seed, so a fresh show boots exactly like the
  // pre-show empty-storage case did. Cast mirrors coerceAuthored's partial-as-AuthoredState contract.
  return { shows: { [id]: { id, name: 'Untitled Show', authored: {} as AuthoredState } }, activeShowId: id };
}

// ---- song library: canonical songs above shows ------------------------------

/* A SONG LIBRARY is a pool of canonical {@link LibrarySong}s (each a self-contained dependency
   closure — see store/song-library.ts) that shows import and reference. It is a SIBLING of the
   show library, one layer up, with its OWN storage key + versioned envelope + a second opaque
   server blob (default.songs.local.json) — the server named-blob store generalizes the show-
   library pattern trivially. This module owns the persisted shape + envelope + defensive load;
   the store wires refs/resolve/detach (S41) and the UI (S42). S40 provides persistence + the
   server seam only, so the library round-trips client + server without any of that live yet. */

/** localStorage key for the song library. Namespaced by schema version like the others. */
export const SONGS_STORAGE_KEY = 'ledrums:songs:v1';

/** Song-library schema version (independent of {@link VERSION}/{@link SHOWS_VERSION}; same
    bump-only-on-incompatible rule). Each song's closure is coerced field-by-field, so an additive
    field on a LibrarySong never needs a bump. */
export const SONGS_VERSION = 1;

/** The persisted song library: canonical songs by id. Unlike {@link ShowLibrary} there is no
    "active" pointer — a library is a pool the shows reference, not a thing you open. */
export interface SongLibrary {
  songs: Record<string, LibrarySong>;
}

/** Versioned envelope written to storage (mirrors {@link PersistedShowLibrary}). */
export interface PersistedSongLibrary {
  version: number;
  data: SongLibrary;
}

/** Wrap a library in the versioned envelope (JSON-safe; the caller stringifies). */
export function serializeSongLibrary(lib: SongLibrary): PersistedSongLibrary {
  return { version: SONGS_VERSION, data: lib };
}

/**
 * Field-by-field coercion of one persisted {@link LibrarySong}. Returns null when the entry is
 * unusable (not an object, or no string id) so the caller drops it; otherwise each closure field
 * is included only when the right container type, defaulting empty — so a partially-corrupt song
 * degrades to what survived rather than wedging the whole library. Same defensive spirit as
 * {@link coerceAuthored}. The container casts trust the closure shapes the extractor produced
 * (validating every graph node / effect spec here would duplicate the sim's own schema).
 */
export function coerceLibrarySong(raw: unknown): LibrarySong | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled Song',
    sections: Array.isArray(raw.sections) ? (raw.sections as SetlistSection[]) : [],
    graphs: isObject(raw.graphs) ? (raw.graphs as Record<string, TriggerGraph>) : {},
    graphNames: isObject(raw.graphNames) ? (raw.graphNames as Record<string, string>) : {},
    effects: Array.isArray(raw.effects) ? (raw.effects as EffectDef[]) : [],
    presets: Array.isArray(raw.presets) ? (raw.presets as Preset[]) : [],
  };
}

/**
 * Validate a parsed song-library blob. Returns null when the envelope is unusable — not an
 * object, a version other than {@link SONGS_VERSION}, or no `songs` record — so the caller falls
 * back to a fresh empty library (never wedges boot). Defensive per song: malformed songs are
 * dropped (an empty pool is legitimate — unlike a show library, a song library may legally hold
 * zero songs, so we do NOT null out on "all dropped"). A song's stored map key is re-pointed to
 * the coerced id so the two never drift.
 */
export function deserializeSongLibrary(raw: unknown): SongLibrary | null {
  if (!isObject(raw)) return null;
  if (raw.version !== SONGS_VERSION) return null;
  const data = raw.data;
  if (!isObject(data) || !isObject(data.songs)) return null;

  const songs: Record<string, LibrarySong> = {};
  for (const rawSong of Object.values(data.songs)) {
    const song = coerceLibrarySong(rawSong);
    if (song) songs[song.id] = song;
  }
  return { songs };
}

/**
 * Build the boot song library from its storage blob. Pure, defensive, never throws: a valid
 * library blob wins; otherwise a fresh EMPTY library (`{ songs: {} }`). There is no legacy
 * single-blob migration — the song library is new in this initiative.
 */
export function loadSongLibrary(rawLibrary: unknown): SongLibrary {
  return deserializeSongLibrary(rawLibrary) ?? { songs: {} };
}
