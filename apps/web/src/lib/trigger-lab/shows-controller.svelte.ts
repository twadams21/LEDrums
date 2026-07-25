/** Shows / setlist / song-library controller (S40/S41/S42) — the FOURTH slice of the trigger-lab
    store split (R23, store split 4/5), extracted from the store god-file into its own
    constructor-injected controller alongside the sibling {@link import('./controller-monitor.svelte').ControllerMonitor}
    (R20), {@link import('./midi-controller.svelte').MidiController} (R21), and
    {@link import('./controller-test.svelte').ControllerTest} (R22).

    Owns the authored DOCUMENT model as a named, multi-show library plus the canonical song pool the
    shows reference:
    - the show library ({@link showLibrary} / {@link activeShowId}) + its {@link shows}/{@link activeShow} views;
    - the setlist songs ({@link songs} / {@link songRefs} / {@link activeSongId}) + the resolved runtime
      view ({@link resolvedView}/{@link resolvedSongs}) that materializes library references (S42);
    - the canonical SONG library ({@link songLibrary}) + its {@link songLibraryList} + ref CRUD;
    - the two server-authoritative library controllers ({@link libSync}/{@link songSync}) driving the
      cold-load-adopt / write-through path, and the localStorage persistence for both blobs.

    Reactivity lives here (Svelte 5 runes fields); the store delegates its public surface via
    getter/setter/forwarders so callers + tests are unchanged. The authored-state SWAP machinery
    (reset-to-seed / apply-authored / graph normalize) spans EVERY authored cluster — graphs, buses,
    presets, effects, sections — not just shows/songs, so it stays in the store and is reached through
    the injected {@link ShowsControllerHost} (`toAuthored`/`applyShow`/`resetAuthoredToSeed`/
    `normalizeGraphs`). The graph MODEL the resolution + closure extraction read/merge is likewise
    store-owned and reached through the host, as is the section-arrangement boundary (R24 owns
    `activeSectionId`) and the WS link. The store keeps the sim-play + section-arrangement surfaces. */

import type { ClientMessage } from '../ws/protocol-types';
import type { EffectDef, Preset, TriggerGraph } from './sim';
import type { Song } from '../app/setlist';
import * as setlist from '../app/setlist';
import {
  STORAGE_KEY,
  SHOWS_STORAGE_KEY,
  SONGS_STORAGE_KEY,
  loadShowLibrary,
  loadSongLibrary,
  serializeShowLibrary,
  serializeSongLibrary,
  deserializeShowLibrary,
  deserializeSongLibrary,
  deserializeAuthored,
  type AuthoredState,
  type Show,
  type ShowLibrary,
  type PersistedShowLibrary,
  type SongLibrary,
  type PersistedSongLibrary,
} from './persistence';
import { ShowLibrarySync } from './store/show-library-sync';
import { SongLibrarySync } from './store/song-library-sync';
import { nid, freshId, reserveIds } from './store/ids';
import { seedSongs } from './store/seed';
import { authoredIdsFromLibrary, idsFromSongLibrary } from './store/reserve-library-ids';
import * as showsLib from './store/shows';
import * as songRefsLib from './store/song-library-refs';
import { extractSongClosure, type ClosureSources } from './store/song-library';

// --- persistence (show library + song pool ⇄ localStorage) --------------------------------------
// The show library's live cache + the canonical song pool's own blob. Guarded for SSR / private-mode
// / quota — a failure never throws into the render loop or lifecycle (persistence is best-effort).

/** Read + JSON-parse a localStorage key. Guards SSR / no-localStorage / quota / malformed JSON —
    any failure yields null (boot keeps the seed). */
function readStoredKey(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** The persisted show library (the live document store). */
function readStoredLibrary(): unknown {
  return readStoredKey(SHOWS_STORAGE_KEY);
}

/** The legacy single-blob authored state — read once at boot to migrate a returning user's implicit
    work into the library (see {@link loadShowLibrary}). */
function readLegacyAuthored(): unknown {
  return readStoredKey(STORAGE_KEY);
}

/** The persisted SONG library (the canonical song pool shows reference). */
function readStoredSongLibrary(): unknown {
  return readStoredKey(SONGS_STORAGE_KEY);
}

/** Write the versioned library envelope. Best-effort — quota / private-mode failures are swallowed
    (persistence must never throw into the render loop or lifecycle). */
export function writeStoredLibrary(payload: PersistedShowLibrary): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Write the versioned SONG-library envelope (best-effort, mirrors {@link writeStoredLibrary}). */
export function writeStoredSongLibrary(payload: PersistedSongLibrary): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** The store-side surface the shows controller depends on — injected so it stays free of the
    authored-state swap machinery, the graph MODEL, the section-arrangement cluster (R24), and the WS
    client lifecycle. All graph-model reads are reactive (they read the store's runes), so the
    resolution deriveds re-run when the graphs change. */
export interface ShowsControllerHost {
  /** The live trigger graphs (reactive) — resolution + closure extraction read them. */
  graphs(): Record<string, TriggerGraph>;
  /** The live graph display labels (reactive). */
  graphNames(): Record<string, string>;
  /** The live effect registry (reactive). */
  effects(): EffectDef[];
  /** The live preset library (reactive). */
  presets(): Preset[];
  /** Merge a detached/imported song closure into the authored graph runes (the store owns them). */
  mergeGraphModel(patch: {
    graphs?: Record<string, TriggerGraph>;
    graphNames?: Record<string, string>;
    effects?: EffectDef[];
    presets?: Preset[];
  }): void;
  /** Read the authored runes into a plain, JSON-safe slice (proxies stripped) — spans every authored
      cluster, so it is owned by the store. */
  toAuthored(): AuthoredState;
  /** Load a show's authored content into the live runes (full swap, no cross-show bleed). */
  applyShow(show: Show): void;
  /** Reset every authored rune to the blank-document seed. */
  resetAuthoredToSeed(): void;
  /** Re-run the graph back-compat normalizers (idempotent) after a seed / library swap. */
  normalizeGraphs(): void;
  /** Re-point the active section (R24 owns the rune) — song switch selects the song's first section. */
  setActiveSectionId(id: string | null): void;
  /** Whether this client is a read-only viewer (S2) — authoring no-ops then. */
  isViewer(): boolean;
  /** Whether the engine WS link is open — gates the server-library write-through + recalls. */
  linkOpen(): boolean;
  /** Send a client message over the engine WS link. */
  send(msg: ClientMessage): void;
}

export class ShowsController {
  // --- shows (the authored document as a named, multi-show library) ---------
  /** Every show by id — the persisted library. The ACTIVE show's `authored` is a stale cache (the
      store's authored runes are the live source of truth while it's active); INACTIVE shows hold
      their last-saved authored verbatim. Hydrated in {@link hydrateFromStorage}. */
  showLibrary = $state<Record<string, Show>>({});
  /** Which show is live — its `authored` is what the store's authored runes mirror. */
  activeShowId = $state<string>('');

  // --- setlist (songs → sections → flat ordered graph lists) ---------------
  /** authored arrangement: songs, each with sections that hold a FLAT ordered list of graph KEYS
      (reuse-by-reference; layering = two graphs sharing a source). */
  songs = $state<Song[]>(seedSongs());
  /** Library-song references (S41): ids into {@link songLibrary} this show resolves into its runtime
      view (canonical propagation — the referenced closure lives in the library, edited once,
      reflected in every show that references it). Authored state (persisted per show); an ordered
      set. See {@link resolvedSongs} for the materialized view. */
  songRefs = $state<string[]>([]);
  /** which song the Sections view + Songs rail show. */
  activeSongId = $state<string>('set-1');

  // --- song library (canonical songs above shows; S40 persistence, S41 refs/resolve) --------
  /** The canonical song pool shows reference (a second server-authoritative library, sibling of
      {@link showLibrary}). Persisted to its own localStorage key + opaque server blob; adopted on
      cold load and pushed on change via {@link songSync}. Hydrated in {@link hydrateFromStorage}. */
  songLibrary = $state<SongLibrary>({ songs: {} });

  /** Server-authoritative show-library controller (cold-load adopt + write-through). */
  private readonly libSync = new ShowLibrarySync();
  /** Server-authoritative SONG-library controller — the sibling of {@link libSync}. */
  private readonly songSync = new SongLibrarySync();
  /** Whether boot found REAL local content (a valid library, or a migratable legacy blob). When
      true, the localStorage cache is the freshest source (written on every edit) and the server's
      cold-load library must not clobber it — see {@link ShowLibrarySync.planReconcile}. */
  private bootedFromLocalLibrary = false;
  /** Whether boot found a REAL local song library — the song-pool sibling of
      {@link bootedFromLocalLibrary}, so the server's cold-load song library can't clobber unsynced
      local song-library edits on a single-writer refresh. */
  private bootedFromLocalSongLibrary = false;

  constructor(private readonly host: ShowsControllerHost) {}

  // --- boot hydration -------------------------------------------------------

  /** Load the show + song libraries from storage into the runes and reserve their ids, then RETURN
      the active show's authored slice for the store to apply over its seed defaults. Called once from
      the store constructor (BEFORE the sim is built / the link opens), so the sim's registries and
      the first setShow/recallSection reflect the ACTIVE show's restored content. Never throws: a
      valid library wins; else a legacy single blob migrates to one "Default Show"; else a fresh
      "Untitled Show" is seeded. */
  hydrateFromStorage(): Partial<AuthoredState> {
    const rawLib = readStoredLibrary();
    const rawSingle = readLegacyAuthored();
    // Did we boot from REAL local content? If so, localStorage is the freshest source (it's written
    // on EVERY edit, while the server push is gated on link/sig), so the server's cold-load library
    // must not overwrite it — only adopt the server when there was nothing local to lose (a
    // cleared/fresh browser). Prevents node positions / wires resetting on refresh.
    this.bootedFromLocalLibrary =
      deserializeShowLibrary(rawLib) !== null || deserializeAuthored(rawSingle) !== null;
    const lib = loadShowLibrary(rawLib, rawSingle, () => nid('show'));
    reserveIds(authoredIdsFromLibrary(lib));
    this.showLibrary = lib.shows;
    this.activeShowId = lib.activeShowId;
    // Load the canonical SONG library from its own blob (a pool shows reference — never wedges boot:
    // a valid blob wins, else a fresh empty pool). Same local-wins signal as the show library, so a
    // single-writer refresh keeps its unsynced song-library edits.
    const rawSongLib = readStoredSongLibrary();
    this.bootedFromLocalSongLibrary = deserializeSongLibrary(rawSongLib) !== null;
    this.songLibrary = loadSongLibrary(rawSongLib);
    // Reserve the POOL ids too (they share the global `song-N` counter with local songs): without
    // this a later local-song mint could reuse a restored pool id, so `resolvedSongs` would carry a
    // local AND a referenced song under one id. ALSO reserve each closure's node/edge ids — those
    // travel raw (un-namespaced) inside library graphs, and S42 lets a user edit a referenced graph,
    // so a fresh node mint must clear them too. Mirrored in {@link adoptSongLibrary} for the server path.
    reserveIds(idsFromSongLibrary(this.songLibrary));
    // Mirror the active show's authored over the store's seed defaults — a migrated/fresh slice is
    // partial, so the store's applyAuthored fills any absent field.
    return $state.snapshot(this.showLibrary[this.activeShowId]!.authored);
  }

  // --- resolved view (S41/S42): the active show with its library references materialized in ------
  // The active show's runtime view is the INVERSE of closure extraction (S41): local songs + resolved
  // references appear as one list; referenced graphs/effects/presets union in collision-free (per-song
  // `lib:<id>/` namespace). The persisted authored state stays UN-resolved (refs, not copies) — every
  // consumer that must SELECT / PLAY / EDIT a referenced song reads through here, so an edit writes to
  // the library rune (canonical propagation) while persistence keeps refs.
  resolvedView = $derived.by(() =>
    songRefsLib.resolveSongRefs(
      {
        songs: this.songs,
        graphs: this.host.graphs(),
        graphNames: this.host.graphNames(),
        effects: this.host.effects(),
        presets: this.host.presets(),
      },
      this.songRefs,
      this.songLibrary,
    ),
  );
  /** The materialized song list (local + referenced) — the setlist the Songs rail + engine read. */
  resolvedSongs = $derived(this.resolvedView.songs);
  /** The song pool as an id+name list for the library UI, with the shows using each (delete-guard
      surface). Insertion order. */
  songLibraryList = $derived(
    Object.values(this.songLibrary.songs).map((s) => ({
      id: s.id,
      name: s.name,
      usedBy: songRefsLib.showsUsingSong(this.refBearingShows(), s.id),
    })),
  );

  // show derived
  /** The show list for the browser UI — `{ id, name }` in insertion order. */
  shows = $derived(Object.values(this.showLibrary).map((s) => ({ id: s.id, name: s.name })));
  /** The active show (id + name + its cached authored). null only before construction completes. */
  activeShow = $derived(this.showLibrary[this.activeShowId] ?? null);
  /** The active song over the RESOLVED song list (local + referenced), so a referenced library song
      is selectable/navigable/playable just like a local one (S42). Falls back to the first resolved
      song. `sections`, firing, and the engine push all read through this (in the store). */
  activeSong = $derived(this.resolvedSongs.find((s) => s.id === this.activeSongId) ?? this.resolvedSongs[0] ?? null);

  // --- library snapshots (persist / sync sources) --------------------------

  /** Write the live authored runes back into the active show's library slot, so its edits are
      captured before we switch away (or persist). No-op if the active id is unknown. */
  private flushActiveToLibrary(): void {
    const active = this.showLibrary[this.activeShowId];
    if (!active) return;
    this.showLibrary = {
      ...this.showLibrary,
      [this.activeShowId]: { ...active, authored: this.host.toAuthored() },
    };
  }

  /** The library to persist: every show, with the ACTIVE show's `authored` refreshed from the live
      runes (inactive shows carried verbatim). Built fresh each autosave tick so the written blob is
      always current without churning the showLibrary rune on every edit. */
  currentLibrary(): ShowLibrary {
    const lib = $state.snapshot(this.showLibrary) as Record<string, Show>;
    const active = lib[this.activeShowId];
    const name = active?.name ?? 'Untitled Show';
    return {
      shows: { ...lib, [this.activeShowId]: { id: this.activeShowId, name, authored: this.host.toAuthored() } },
      activeShowId: this.activeShowId,
    };
  }

  /** The SONG library to persist — a plain snapshot of the pool rune (no active-slot flush like the
      show library: song refs live in each show's `authored`, so the pool itself is the whole truth).
      Built fresh each tick so the written blob is current without churning the rune. */
  currentSongLibrary(): SongLibrary {
    return $state.snapshot(this.songLibrary) as SongLibrary;
  }

  // --- show document lifecycle (new / open / save / save-as / rename / delete / close) ---
  // A show is the authored content given identity; the store's live authored runes mirror the ACTIVE
  // show. Every switch flushes the outgoing show's edits into its library slot, then fully swaps the
  // runes via the host's applyShow (no cross-show bleed). The new active content reaches the engine
  // through the same debounced autosave path as any other authored edit.

  /** Create a blank show (seed content) and switch to it. Name defaults to the first unused "Untitled
      Show [N]". The previous show's edits are flushed to its slot first. Returns the new id. */
  newShow(name?: string): string {
    if (this.host.isViewer()) return this.activeShowId; // read-only viewer (S2): authoring no-op
    this.flushActiveToLibrary();
    const id = this.freshShowId();
    const label = name?.trim() || showsLib.nextShowName(this.showLibrary);
    this.host.resetAuthoredToSeed();
    this.host.normalizeGraphs();
    this.showLibrary = showsLib.withShow(this.showLibrary, { id, name: label, authored: this.host.toAuthored() });
    this.activeShowId = id;
    return id;
  }

  /** Switch to a saved show: flush the current show's edits, then load the target's authored into the
      runes (full swap). No-op for an unknown id or the already-active show. */
  openShow(id: string): void {
    if (id === this.activeShowId || !this.showLibrary[id]) return;
    this.flushActiveToLibrary();
    this.activeShowId = id;
    this.host.applyShow(this.showLibrary[id]!);
  }

  /** Deliberately persist the active show NOW (flush runes → slot → storage). Autosave already covers
      this on a debounce; saveShow is the explicit, immediate write/confirmation. */
  saveShow(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    this.flushActiveToLibrary();
    writeStoredLibrary(serializeShowLibrary(this.currentLibrary()));
  }

  /** Clone the current authored content under a new id + name and switch to the clone — the source
      show keeps its content. Name defaults to the first unused "Untitled Show [N]". Returns the new id. */
  saveShowAs(name: string): string {
    if (this.host.isViewer()) return this.activeShowId; // read-only viewer (S2): authoring no-op
    this.flushActiveToLibrary();
    const id = this.freshShowId();
    const label = name.trim() || showsLib.nextShowName(this.showLibrary);
    // The clone's content == the current live runes, so no reload is needed after the switch.
    this.showLibrary = showsLib.withShow(this.showLibrary, { id, name: label, authored: this.host.toAuthored() });
    this.activeShowId = id;
    return id;
  }

  /** Rename a show. No-op on an unknown id or a blank name (keeps the old name, mirrors
      {@link renameSong}). */
  renameShow(id: string, name: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    this.showLibrary = showsLib.renameShowIn(this.showLibrary, id, name);
  }

  /** Delete a show. Never leaves zero shows — deleting the last one seeds a fresh "Untitled Show".
      When the ACTIVE show is deleted, re-points to its left neighbour (else the new first) and swaps
      that show's authored into the runes. No-op on an unknown id. */
  deleteShow(id: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    const plan = showsLib.planDeleteShow(this.showLibrary, this.activeShowId, id);
    if (plan.kind === 'noop') return;
    if (plan.kind === 'reseed') {
      // deleted the only show → start over from a blank Untitled (mirrors closeShow's reset).
      const freshShowId = this.freshShowId();
      this.host.resetAuthoredToSeed();
      this.host.normalizeGraphs();
      this.showLibrary = { [freshShowId]: { id: freshShowId, name: 'Untitled Show', authored: this.host.toAuthored() } };
      this.activeShowId = freshShowId;
      return;
    }
    this.showLibrary = plan.library;
    this.activeShowId = plan.activeShowId;
    if (plan.reload) this.host.applyShow(plan.reload);
  }

  /** Close the active show: it's already saved in the library, so just switch to a fresh blank
      "Untitled Show" (a clean slate to start over). */
  closeShow(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    this.newShow();
  }

  /** Smallest unused show id (survives reload — the global nid counter + the live library). */
  private freshShowId(): string {
    return freshId('show', (id) => id in this.showLibrary);
  }

  // --- song library references (export / import / detach / CRUD + delete guard) ------------
  // The inverse of extraction: a show REFERENCES canonical library songs (`songRefs`), which
  // {@link resolvedView} materializes back into the runtime view. Editing a referenced song edits the
  // LIBRARY copy (canonical propagation — every referencing show re-resolves); detach clones the
  // closure locally to sever that link; deleting an in-use song is blocked. Pure decisions live in
  // store/song-library-refs.ts; these thin methods own the rune swap + id minting.

  /** The show list adapted to the delete guard's shape — each show's `songRefs` (the ACTIVE show's
      LIVE refs, inactive shows their saved slot), so "used by" reflects unsaved edits too. */
  private refBearingShows(): songRefsLib.RefBearingShow[] {
    return Object.values(this.showLibrary).map((s) => ({
      id: s.id,
      name: s.name,
      songRefs: s.id === this.activeShowId ? this.songRefs : s.authored.songRefs,
    }));
  }

  /** Export a LOCAL song into the canonical library: extract its dependency closure (namespaced,
      self-contained) under a fresh pool id and add it. Returns the new library-song id, or null on an
      unknown song id / a viewer. Does NOT alter the show's own songs or refs — importing a reference
      (so edits propagate) is a separate, explicit step. */
  exportSongToLibrary(songId: string): string | null {
    if (this.host.isViewer()) return null; // read-only viewer (S2): authoring no-op
    const song = this.songs.find((s) => s.id === songId);
    if (!song) return null;
    const libId = freshId('song', (id) => id in this.songLibrary.songs);
    const sources: ClosureSources = {
      graphs: $state.snapshot(this.host.graphs()),
      graphNames: $state.snapshot(this.host.graphNames()),
      effects: $state.snapshot(this.host.effects()),
      presets: $state.snapshot(this.host.presets()),
    };
    const closure = extractSongClosure($state.snapshot(song), sources, libId);
    this.songLibrary = songRefsLib.withLibrarySong(this.songLibrary, closure);
    return libId;
  }

  /** Reference a library song from the active show — it then resolves into the runtime view and
      tracks the library copy (canonical propagation). No-op on an unknown library id, an already-
      referenced id, or a viewer. */
  importSongReference(librarySongId: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.songLibrary.songs[librarySongId]) return; // nothing to reference
    this.songRefs = songRefsLib.addSongRef(this.songRefs, librarySongId);
  }

  /** Drop a library-song reference from the active show WITHOUT cloning — the exact inverse of
      {@link importSongReference}. The referenced song leaves the resolved view; the canonical library
      copy is untouched (other shows keep referencing it). No-op on an un-referenced id or a viewer.
      Distinct from {@link detachSongReference}, which keeps the content as a local copy. */
  removeSongReference(librarySongId: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    this.songRefs = songRefsLib.removeSongRef(this.songRefs, librarySongId);
  }

  /** Detach a referenced library song into a LOCAL copy of the active show — clones the closure under
      a fresh namespace, merges it into the authored runes, and drops the reference (severing canonical
      propagation). Returns the new local song id, or null on an unknown/un-referenced id or a viewer. */
  detachSongReference(librarySongId: string): string | null {
    if (this.host.isViewer()) return null; // read-only viewer (S2): authoring no-op
    const libSong = this.songLibrary.songs[librarySongId];
    if (!libSong) return null;
    const newId = freshId('song', (id) => this.songs.some((s) => s.id === id));
    const detached = songRefsLib.detachLibrarySong($state.snapshot(libSong), newId);
    this.host.mergeGraphModel({
      graphs: detached.graphs,
      graphNames: detached.graphNames,
      effects: detached.effects,
      presets: detached.presets,
    });
    this.songs = [...this.songs, detached.song];
    this.songRefs = songRefsLib.removeSongRef(this.songRefs, librarySongId);
    return newId;
  }

  /** Rename a library song. No-op on an unknown id, a blank name, or a viewer. The rename propagates
      to every referencing show's resolved view (canonical). */
  renameLibrarySong(librarySongId: string, name: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    this.songLibrary = songRefsLib.renameLibrarySongIn(this.songLibrary, librarySongId, name);
  }

  /** Delete a library song, BLOCKED while any show references it. Returns the using shows (id + name)
      when blocked — a non-empty list means nothing was deleted; an empty list means it was removed (or
      the id was unknown). A viewer is always a no-op (empty). */
  deleteLibrarySong(librarySongId: string): { id: string; name: string }[] {
    if (this.host.isViewer()) return []; // read-only viewer (S2): authoring no-op
    const plan = songRefsLib.planDeleteLibrarySong(this.songLibrary, this.refBearingShows(), librarySongId);
    if (plan.kind === 'blocked') return plan.usedBy;
    this.songLibrary = plan.library;
    return [];
  }

  /** Which shows (id + name) reference a library song — the "used by" list the UI shows and the
      delete guard reports. */
  showsUsingSong(librarySongId: string): { id: string; name: string }[] {
    return songRefsLib.showsUsingSong(this.refBearingShows(), librarySongId);
  }

  // --- setlist song CRUD (create / rename / duplicate / remove / activate) --------------------

  setActiveSong(songId: string): void {
    // Resolved (S42): a referenced library song is a valid active song (navigable + playable), so
    // validate + read its first section from the resolved list, not just the local songs.
    if (!this.resolvedSongs.some((s) => s.id === songId)) return;
    this.activeSongId = songId;
    const firstSectionId = this.resolvedSongs.find((s) => s.id === songId)?.sections[0]?.id ?? null;
    this.host.setActiveSectionId(firstSectionId);
    if (this.host.linkOpen() && firstSectionId) {
      this.host.send({ t: 'recallSection', songId, sectionId: firstSectionId });
    }
  }

  /** Create a new, empty song (one empty section), append it to `songs`, make it the active song, and
      return its id. Name defaults to "New song N" (first unused). Persists via the authored-state
      autosave (`songs` is part of the snapshot). */
  createSong(name?: string): string {
    if (this.host.isViewer()) return this.activeSongId; // read-only viewer (S2): authoring no-op
    const id = freshId('song', (k) => this.songs.some((s) => s.id === k)); // global uniqueness (survives reload)
    const label = name?.trim() || this.nextSongName();
    this.songs = [...this.songs, setlist.makeSong(id, label)];
    this.setActiveSong(id); // points activeSectionId at the new song's first section
    return id;
  }

  /** Smallest unused "New song N" label, so auto-named songs stay distinct. */
  private nextSongName(): string {
    const used = new Set(this.songs.map((s) => s.name));
    let n = 1;
    while (used.has(`New song ${n}`)) n++;
    return `New song ${n}`;
  }

  /** Rename a song. No-op if the id is unknown or the trimmed name is empty (a blank rename keeps the
      old name rather than clearing it). Persists via autosave. */
  renameSong(id: string, name: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    const trimmed = name.trim();
    if (!trimmed) return;
    this.songs = this.songs.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
  }

  /** Duplicate a song: append an independent "<name> copy" (every section deep-copied under a fresh
      id, so the clone's arrangement edits without touching the source — graph KEYS stay shared, i.e.
      reuse) and make it active. Returns the new id, or null if `id` is unknown. */
  duplicateSong(id: string): string | null {
    if (this.host.isViewer()) return null; // read-only viewer (S2): authoring no-op
    const src = this.songs.find((s) => s.id === id);
    if (!src) return null;
    const newId = freshId('song', (k) => this.songs.some((s) => s.id === k));
    const sections = src.sections.map((sec) => setlist.cloneSection(sec, nid('section'), sec.name));
    this.songs = [...this.songs, setlist.makeSong(newId, `${src.name} copy`, sections)];
    this.setActiveSong(newId);
    return newId;
  }

  /** Remove a song. When the removed song was active, re-points `activeSongId` to a sensible
      neighbour (the next song, else the new last). Guards the LAST song: removing the only song is a
      no-op, so the app always has a song to show + edit. Persists via autosave. */
  removeSong(id: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (this.songs.length <= 1) return; // never delete the last song (activeSong would go null)
    const idx = this.songs.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const wasActive = this.activeSongId === id;
    this.songs = this.songs.filter((s) => s.id !== id);
    if (wasActive) {
      const next = this.songs[idx] ?? this.songs[this.songs.length - 1]!;
      this.setActiveSong(next.id);
    }
  }

  // --- server-authoritative libraries (cold-load adopt + write-through) --------------
  // The server owns the authored show library + canonical song pool (like the routing Project): it
  // persists them and broadcasts them on the `state` message. The web ADOPTS each once, on the first
  // state of a cold load (server wins); thereafter the web is the source and pushes every change up.
  // localStorage is a fast cache. The once-per-session gate + echo suppression live in the two
  // ShowLibrarySync/SongLibrarySync controllers.

  /** Reconcile BOTH server libraries against ours on a `state` message — the cold-load adopt (server
      wins) / seed-from-cache / viewer-follow path for the show library AND the canonical song pool.
      Presence arrives before this state on a (re)connect, so the viewer role is already settled. */
  reconcileOnState(rawShowLibrary: unknown, rawSongLibrary: unknown): void {
    // markServerStateSeen first so the seed-push isn't gated off.
    this.libSync.markServerStateSeen();
    const plan = this.libSync.planReconcile(rawShowLibrary, this.bootedFromLocalLibrary, this.host.isViewer());
    if (plan.kind === 'adopt') {
      this.adoptLibrary(plan.library);
      // The server already holds this library, so mark synced WITHOUT echoing it back. A later
      // authored edit diverges the signature and pushes normally.
      this.libSync.noteSynced(this.libSync.librarySig(this.currentLibrary()));
    } else if (plan.kind === 'seed') {
      this.syncLibraryToServer(); // server has no library yet → seed it from our localStorage cache
    }
    // Cold-load reconcile of the canonical SONG library — the exact sibling of the show-library path.
    this.songSync.markServerStateSeen();
    const songPlan = this.songSync.planReconcile(rawSongLibrary, this.bootedFromLocalSongLibrary, this.host.isViewer());
    if (songPlan.kind === 'adopt') {
      this.adoptSongLibrary(songPlan.library);
      this.songSync.noteSynced(this.songSync.librarySig(this.currentSongLibrary()));
    } else if (songPlan.kind === 'seed') {
      this.syncSongLibraryToServer();
    }
  }

  /** Follow a live authored show-library push from the editor (relayed by the server). Only a VIEWER
      follows it (the editor is the source and is never sent its own echo). Adopt sig-guarded, then
      mark synced so the adopted content isn't pushed back up. */
  followShowLibrary(raw: unknown): void {
    if (!this.host.isViewer()) return;
    const plan = this.libSync.planFollow(raw);
    if (plan.kind === 'adopt') {
      this.adoptLibrary(plan.library);
      this.libSync.noteSynced(this.libSync.librarySig(this.currentLibrary()));
    }
  }

  /** Follow a live SONG-library push from the editor — the sibling of {@link followShowLibrary}. Only
      a viewer follows it; adopt sig-guarded, then mark synced. */
  followSongLibrary(raw: unknown): void {
    if (!this.host.isViewer()) return;
    const plan = this.songSync.planFollow(raw);
    if (plan.kind === 'adopt') {
      this.adoptSongLibrary(plan.library);
      this.songSync.noteSynced(this.songSync.librarySig(this.currentSongLibrary()));
    }
  }

  /** Swap the live runes to the adopted server library (mirrors the constructor's hydrate, but as a
      runtime switch): replace the library + active pointer, then load the active show's authored over
      the blank seed and re-normalize. A FULL swap — no field of the prior library bleeds through. */
  private adoptLibrary(lib: ShowLibrary): void {
    this.showLibrary = lib.shows;
    this.activeShowId = lib.activeShowId;
    this.host.applyShow(lib.shows[lib.activeShowId]!);
  }

  /** Push the current library to the server when it actually changed (sig-guarded so an unchanged
      library isn't re-sent every autosave tick). Gated on the first `state` having been seen, so the
      cold-load adopt always wins the race against the debounced autosave. */
  syncLibraryToServer(): void {
    if (!this.host.linkOpen() || this.host.isViewer()) return; // a viewer follows the editor — never authors up
    const envelope = serializeShowLibrary(this.currentLibrary());
    if (!this.libSync.planPush(envelope)) return;
    this.host.send({ t: 'setShowLibrary', library: envelope });
  }

  /** Swap the live song-pool rune to the adopted server song library — the sibling of
      {@link adoptLibrary}. The pool has no active pointer + no live authored mirror, so this is a
      plain rune replace (the shows that reference it re-resolve reactively). */
  private adoptSongLibrary(lib: SongLibrary): void {
    this.songLibrary = lib;
    // Reserve the adopted pool ids AND each closure's raw node/edge ids into the global counter, so a
    // later local mint can't reuse one and collide (the cross-process case: machine A's exported
    // `song-N` / `n-N` arrives here before this client mints its own). See hydrateFromStorage's reserve.
    reserveIds(idsFromSongLibrary(lib));
  }

  /** Push the current song library to the server when it actually changed (sig-guarded, gated on the
      first `state`) — the sibling of {@link syncLibraryToServer}. */
  syncSongLibraryToServer(): void {
    if (!this.host.linkOpen() || this.host.isViewer()) return; // a viewer follows the editor — never authors up
    const envelope = serializeSongLibrary(this.currentSongLibrary());
    if (!this.songSync.planPush(envelope)) return;
    this.host.send({ t: 'setSongLibrary', library: envelope });
  }
}
