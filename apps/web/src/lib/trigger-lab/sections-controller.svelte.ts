/** Section-arrangement controller (R24) — the FIFTH and FINAL slice of the trigger-lab store split,
    extracted from the store god-file into its own constructor-injected controller alongside the
    sibling {@link import('./controller-monitor.svelte').ControllerMonitor} (R20),
    {@link import('./midi-controller.svelte').MidiController} (R21),
    {@link import('./controller-test.svelte').ControllerTest} (R22), and
    {@link import('./shows-controller.svelte').ShowsController} (R23).

    Owns the section-arrangement AUTHORING model for the ACTIVE song:
    - the ONE active/selected section pointer ({@link activeSectionId}) — U4 merged the old
      look-recall + arrange focus, so the section you play IS the one you edit — plus the
      transient section {@link sectionClipboard};
    - the {@link activeSection} / {@link sections} deriveds (read the active song through the host,
      so a referenced-library song's sections resolve just like a local one, S42);
    - section CRUD (add / rename / remove / reorder sections + per-section graph-slot edits +
      looks, S16) — every edit funnels through {@link updateActiveSong}, mutating the `songs` rune
      that {@link ShowsController} owns (R23), reached through the host's songs get/set.

    Reactivity lives here (Svelte 5 runes fields); the store delegates its public surface via
    getter/setter/forwarders so callers + tests are unchanged. The sim PLAY surface (hit /
    fireSectionGraph / setActiveSection's look recall) stays in the store — this split extracts the
    arrangement/authoring model, not the play surface. The lone play-surface touch here is
    {@link setLook}'s offline re-morph, reached through the injected {@link SectionsControllerHost}
    (`recallSectionLook`). The active-song reads + the `songs` rune swap are host calls too. */

import { SECTIONS } from './fixtures';
import type { Section } from './sim';
import type { SetlistSection, Song } from '../app/setlist';
import * as setlist from '../app/setlist';
import { nid } from './store/ids';
import type { TriggerGraph } from './sim';

export type SectionClipboard = SetlistSection & {
  graphSnapshots: Record<string, TriggerGraph>;
  graphNameSnapshots: Record<string, string>;
};

/** The store-side surface the section controller depends on — injected so it stays free of the
    `songs` rune (owned by {@link ShowsController}, R23), the sim play surface, and the WS link.
    Reads are reactive (they read the store's delegators, which read the owning runes), so the
    section deriveds re-run when the active song / its sections change. */
export interface SectionsControllerHost {
  /** Whether this client is a read-only viewer (S2) — authoring no-ops then. */
  isViewer(): boolean;
  /** The active song over the RESOLVED song list (local + referenced) — the deriveds + section
      reads read its `sections`. null before construction completes / with no song. */
  activeSong(): Song | null;
  /** The id of the active song — the {@link updateActiveSong} chokepoint targets it. */
  activeSongId(): string;
  /** The live setlist songs rune (owned by ShowsController, R23) — read for the immutable map. */
  songs(): Song[];
  /** Whether a song id belongs to this show's authored setlist (canonical library songs do not). */
  isLocalSong(songId: string): boolean;
  /** Write the setlist songs rune back (the section edit's only mutation surface). */
  setSongs(songs: Song[]): void;
  /** Record one authored checkpoint before a section/document mutation. */
  recordUndo(): void;
  /** The local graph model used to snapshot and materialize section copies. */
  graphs(): Record<string, TriggerGraph>;
  graphNames(): Record<string, string>;
  mergeGraphModel(patch: { graphs?: Record<string, TriggerGraph>; graphNames?: Record<string, string> }): void;
  /** Mint an id in the owning store and deep-copy a section graph closure. */
  cloneSectionGraphs(
    section: SetlistSection,
    graphs: Record<string, TriggerGraph>,
    graphNames: Record<string, string>,
  ): { section: SetlistSection; graphs: Record<string, TriggerGraph>; graphNames: Record<string, string> };
  /** Whether the engine WS link is open — gates {@link setLook}'s offline re-morph. */
  linkOpen(): boolean;
  /** Re-morph the offline sim to a freshly-edited active-section look (sim.recallSection +
      snapshot) — the store owns the sim play surface. */
  recallSectionLook(look: Section): void;
}

export class SectionsController {
  /** The ONE active section (U4 merged the old `activeSectionId` look-recall + `arrangeSectionId`
      arrange focus): the section you're playing IS the one you're editing. Drives hit-resolution
      (its graphs fire, in the store's play surface), the look-morph recall, and the
      Sections / Trigger views' highlight. Defaults to the first fixture section. */
  activeSectionId = $state<string | null>(SECTIONS[0]?.id ?? null);
  /** Section copy/paste scratch — a deep copy of the last-copied section (id+name+graph list), or
      null when nothing is on the clipboard. Transient (NOT persisted): a fresh session starts with
      an empty clipboard. {@link pasteSection} clones this under a new id. */
  sectionClipboard = $state<SectionClipboard | null>(null);

  constructor(private readonly host: SectionsControllerHost) {}

  /** The active section (SetlistSection) in the active song — the section you play + edit. Its flat
      `graphs` list drives hit-resolution + the Sections/Trigger views (in the store). `$derived.by`
      so the host reads live inside a closure — a field initializer that referenced `this.host`
      directly trips strict "used before init" (host is a constructor param). */
  activeSection = $derived.by(
    () => this.host.activeSong()?.sections.find((s) => s.id === this.activeSectionId) ?? null,
  );
  /** The look-morph section list (`{ id, name, looks }`) the engine spawns on recall, the offline
      sim recalls, and the Perform view lists — DERIVED from the active song's authored sections so
      authored looks (S16) are the single source of truth (no separate fixture look array to drift).
      `buildShow` reads this for `Show.sections` (in the store); the offline `setActiveSection` recall
      resolves the look here. Empty when there is no active song. */
  sections = $derived.by((): Section[] =>
    (this.host.activeSong()?.sections ?? []).map((s) => ({ id: s.id, name: s.name, looks: s.looks })),
  );

  // --- setlist arranging (sections → per-drum graph slots) ------------------
  // The section-arrangement edits below go through {@link updateActiveSong} against the songs rune
  // ShowsController owns (R23, read/written via the host), and re-point `activeSectionId`.

  /** Mutate the active song immutably via the pure setlist ops, then store it back. The single
      chokepoint for every section + graph-slot edit, so the viewer read-only guard here covers
      addSection/renameSection/removeSection + add/remove/reorder graphs (S2). */
  private updateActiveSong(fn: (song: Song) => Song): boolean {
    if (this.host.isViewer()) return false; // read-only viewer (S2): authoring no-op
    const id = this.host.activeSongId();
    const songs = this.host.songs();
    if (!this.host.isLocalSong(id)) return false;
    const next = songs.map((s) => (s.id === id ? fn(s) : s));
    if (next.some((song, index) => song !== songs[index])) {
      this.host.recordUndo();
      this.host.setSongs(next);
      return true;
    }
    return false;
  }

  /** Append a graph reference to a section's flat list (idempotent — see setlist.addGraph). */
  addGraphToSection(sectionId: string, graphKey: string): boolean {
    if (!this.host.graphs()[graphKey]) return false;
    return this.updateActiveSong((song) => setlist.addGraph(song, sectionId, graphKey));
  }

  /** Link an exact target placement to the source placement's graph. Both placements must be
      local authored sections; referenced library sections stay canonical/read-only here. */
  linkGraphPlacement(
    sourceSongId: string,
    sourceSectionId: string,
    sourceGraphKey: string,
    targetSongId: string,
    targetSectionId: string,
    targetGraphKey: string,
  ): void {
    if (this.host.isViewer() || sourceGraphKey === targetGraphKey) return;
    const songs = this.host.songs();
    const sourceSong = songs.find((song) => song.id === sourceSongId);
    const targetSong = songs.find((song) => song.id === targetSongId);
    const sourceSection = sourceSong?.sections.find((section) => section.id === sourceSectionId);
    const targetSection = targetSong?.sections.find((section) => section.id === targetSectionId);
    if (!sourceSection?.graphs.includes(sourceGraphKey) || !targetSection?.graphs.includes(targetGraphKey)) return;
    if (!this.host.graphs()[sourceGraphKey]) return;
    const next = songs.map((song) =>
      song.id === targetSongId ? setlist.replaceGraphPlacement(song, targetSectionId, targetGraphKey, sourceGraphKey) : song,
    );
    if (next.some((song, index) => song !== songs[index])) {
      this.host.recordUndo();
      this.host.setSongs(next);
    }
  }

  /** Break one exact placement out of a linked group, preserving its current content and label. */
  unlinkGraphPlacement(songId: string, sectionId: string, graphKey: string): void {
    if (this.host.isViewer()) return;
    const songs = this.host.songs();
    const song = songs.find((candidate) => candidate.id === songId);
    const section = song?.sections.find((candidate) => candidate.id === sectionId);
    if (!section?.graphs.includes(graphKey) || setlist.graphPlacementCount(songs, graphKey) < 2) return;
    const cloned = this.host.cloneSectionGraphs(
      { ...section, graphs: [graphKey] },
      this.host.graphs(),
      this.host.graphNames(),
    );
    const next = songs.map((candidate) =>
      candidate.id === songId ? setlist.replaceGraphPlacement(candidate, sectionId, graphKey, cloned.section.graphs[0] ?? graphKey) : candidate,
    );
    if (next.some((candidate, index) => candidate !== songs[index])) {
      this.host.recordUndo();
      this.host.mergeGraphModel({ graphs: cloned.graphs, graphNames: cloned.graphNames });
      this.host.setSongs(next);
    }
  }
  /** Remove a graph reference from a section's flat list. */
  removeGraphFromSection(sectionId: string, graphKey: string): void {
    this.updateActiveSong((song) => setlist.removeGraph(song, sectionId, graphKey));
  }
  /** Replace a section's whole graph list (de-duplicated, order preserved) — for reorder. */
  setSectionGraphs(sectionId: string, graphs: string[]): void {
    this.updateActiveSong((song) => setlist.setGraphs(song, sectionId, graphs));
  }

  /** Reorder a section in the active song by drag/drop. */
  moveSection(sectionId: string, toIndex: number): void {
    this.updateActiveSong((song) => setlist.moveSection(song, sectionId, toIndex));
  }

  /** Move one graph placement within a section or across sections by drag/drop. */
  moveGraphPlacement(fromSectionId: string, graphKey: string, toSectionId: string, toIndex: number): void {
    this.updateActiveSong((song) => setlist.moveGraphPlacement(song, fromSectionId, graphKey, toSectionId, toIndex));
  }

  /** Set (or clear) the effect a section LOOPS on a bus — its "look" (S16). `effectId` `null`
      = None. Rides the standard authored-edit path: the mutation to `songs` persists via
      autosave and live-resyncs the Show to the engine (the debounced `syncShowToServer`
      re-sends `setShow` + re-recalls the active section, so a look edited on the active section
      re-morphs with the new effect). Offline — where that resync never runs — re-morph the
      local sim NOW when the edited section is the active one, so the pick is immediately
      visible/audible in the preview; connected we defer to the resync's re-recall (an immediate
      recall would race the not-yet-sent Show, spawning the stale look). */
  setLook(sectionId: string, busId: string, effectId: string | null): void {
    const changed = this.updateActiveSong((song) => setlist.setLook(song, sectionId, busId, effectId));
    if (changed && !this.host.linkOpen() && sectionId === this.activeSectionId) {
      const look = this.sections.find((s) => s.id === sectionId);
      if (look) this.host.recallSectionLook(look);
    }
  }
  addSongSection(name: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.host.isLocalSong(this.host.activeSongId())) return;
    const id = nid('section');
    if (this.updateActiveSong((song) => setlist.addSection(song, setlist.makeSection(id, name)))) {
      this.activeSectionId = id;
    }
  }

  /** Rename a section of the active song (no-op-safe on an unknown id). Persists via the
      authored autosave like every other section edit. */
  renameSection(sectionId: string, name: string): void {
    this.updateActiveSong((song) => setlist.renameSection(song, sectionId, name));
  }

  /** Delete a section from the active song. When it was the ACTIVE section, re-point
      `activeSectionId` to a sensible neighbour — the section to its left, else the new
      first section, else `null` once none remain. No-op on an unknown id. Persists via the
      authored autosave. */
  removeSection(sectionId: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.host.isLocalSong(this.host.activeSongId())) return;
    const idx = (this.host.activeSong()?.sections ?? []).findIndex((s) => s.id === sectionId);
    if (idx < 0) return; // not a section of the active song
    const changed = this.updateActiveSong((song) => setlist.removeSection(song, sectionId));
    if (changed && this.activeSectionId === sectionId) {
      const remaining = this.host.activeSong()?.sections ?? [];
      this.activeSectionId = (remaining[idx - 1] ?? remaining[0])?.id ?? null;
    }
  }

  /** Copy a section of the active song onto the clipboard, including a detached snapshot of its
      graph closure, so later edits to the source never bleed into it. No-op if the id isn't a
      section of the active song. */
  copySection(sectionId: string): boolean {
    if (!this.host.isLocalSong(this.host.activeSongId())) return false;
    const sec = this.host.activeSong()?.sections.find((s) => s.id === sectionId);
    if (!sec) return false;
    // clone under its own id/name → a plain snapshot; pasteSection re-clones with a fresh id.
    const snapshot = setlist.cloneSection(sec, sec.id, sec.name);
    const graphs: Record<string, TriggerGraph> = {};
    const graphNames: Record<string, string> = {};
    for (const key of snapshot.graphs) {
      const graph = this.host.graphs()[key];
      // A clipboard snapshot must be complete. Keep the previous clipboard untouched when a
      // legacy/dangling section cannot be copied safely.
      if (!graph) return false;
      graphs[key] = structuredClone(graph);
      const name = this.host.graphNames()[key];
      if (typeof name === 'string') graphNames[key] = name;
    }
    this.sectionClipboard = { ...snapshot, graphSnapshots: graphs, graphNameSnapshots: graphNames };
    return true;
  }

  /** Paste the clipboard as a NEW section appended to the active song (fresh id, name
      "<name> copy"), and make it active. No-op when the clipboard is empty. The section and its
      referenced graph closure are deep-copied under fresh keys; repeated source keys stay one
      linked graph within this operation. */
  pasteSection(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.host.isLocalSong(this.host.activeSongId())) return;
    const clip = this.sectionClipboard;
    if (!clip) return;
    const id = nid('section');
    const source = setlist.cloneSection(clip, id);
    const cloned = this.host.cloneSectionGraphs(source, clip.graphSnapshots, clip.graphNameSnapshots);
    if (!this.updateActiveSong((song) => setlist.addSection(song, cloned.section))) return;
    this.host.mergeGraphModel({ graphs: cloned.graphs, graphNames: cloned.graphNames });
    this.activeSectionId = id;
  }

  /** Duplicate a section in one step (copy + paste): appends an independent "<name> copy"
      after the song's sections and activates it. */
  duplicateSection(sectionId: string): void {
    if (this.copySection(sectionId)) this.pasteSection();
  }

  /** Append an already-built section object to the active song and make it active — the section
      insertion a system-clipboard (S44) paste performs after remapping its closure into this show.
      Mirrors {@link pasteSection}'s tail without the in-app clipboard clone (the caller supplies the
      remapped section). */
  insertSection(section: SetlistSection): boolean {
    if (!this.host.isLocalSong(this.host.activeSongId())) return false;
    if (!this.updateActiveSong((song) => setlist.addSection(song, section))) return false;
    this.activeSectionId = section.id;
    return true;
  }
}
