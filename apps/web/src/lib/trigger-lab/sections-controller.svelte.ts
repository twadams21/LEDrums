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
    - the {@link activeSection} derived (reads the exact active song through the host, so a
      referenced-library song's sections resolve just like a local one, S42);
    - section CRUD (add / rename / remove / reorder / copy / paste) — every edit funnels through
      {@link updateActiveSong}, mutating the `songs` rune that {@link ShowsController} owns (R23),
      reached through the host's songs get/set.

    Reactivity lives here (Svelte 5 runes fields); the store delegates its public surface via
    getter/setter/forwarders so callers + tests are unchanged. The play surface (hit, recall) stays
    in the store. */

import type { SetlistSection, Song } from '../app/setlist';
import * as setlist from '../app/setlist';
import { nid } from './store/ids';

/** A detached copy of the last-copied section (its Effect stack and Master chain included). */
export type SectionClipboard = SetlistSection;

/** The store-side surface the section controller depends on — injected so it stays free of the
    `songs` rune (owned by {@link ShowsController}, R23), the play surface, and the WS link.
    Reads are reactive (they read the store's delegators, which read the owning runes), so the
    section deriveds re-run when the active song / its sections change. */
export interface SectionsControllerHost {
  /** Whether this client is a read-only viewer (S2) — authoring no-ops then. */
  isViewer(): boolean;
  /** The exact active song over the RESOLVED song list (local + referenced). No fallback: stale
      active ids must not make a different song look like the mutation target. */
  activeSongById(): Song | null;
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
  /** The active section id just changed (any path). The store re-points the Effects selection
      at the new section. */
  activeSectionChanged(): void;
}

export class SectionsController {
  /** The ONE active section (U4 merged the old `activeSectionId` look-recall + `arrangeSectionId`
      arrange focus): the section you're playing IS the one you're editing. Drives hit-resolution
      (its Effects fire, in the store's play surface), the recall, and the Sections / Effects
      views' highlight. An accessor so EVERY re-point (activate, step, recall, add/paste/remove
      section) tells the host — see {@link SectionsControllerHost.activeSectionChanged}. */
  #activeSectionId = $state<string | null>(null);
  get activeSectionId(): string | null {
    return this.#activeSectionId;
  }
  set activeSectionId(id: string | null) {
    if (id === this.#activeSectionId) return;
    this.#activeSectionId = id;
    this.host.activeSectionChanged();
  }
  /** Section copy/paste scratch — a deep copy of the last-copied section, or null when nothing is
      on the clipboard. Transient (NOT persisted): a fresh session starts with an empty clipboard.
      {@link pasteSection} clones this under a new id. */
  sectionClipboard = $state<SectionClipboard | null>(null);

  constructor(private readonly host: SectionsControllerHost) {}

  /** Keep the active section aligned with the exact active song after an id or document swap.
      A stale song clears the pointer; a valid song with a stale section selects its first section. */
  reconcileActiveSection(): void {
    const song = this.host.activeSongById();
    if (!song) {
      this.activeSectionId = null;
      return;
    }
    if (this.activeSectionId !== null && song.sections.some((section) => section.id === this.activeSectionId)) return;
    this.activeSectionId = song.sections[0]?.id ?? null;
  }

  /** The active section (SetlistSection) in the active song — the section you play + edit.
      `$derived.by` so the host reads live inside a closure — a field initializer that referenced
      `this.host` directly trips strict "used before init" (host is a constructor param). */
  activeSection = $derived.by(
    () => this.host.activeSongById()?.sections.find((s) => s.id === this.activeSectionId) ?? null,
  );

  /** Mutate the active song immutably via the pure setlist ops, then store it back. The single
      chokepoint for every section edit, so the viewer read-only guard here covers
      addSection/renameSection/removeSection/moveSection (S2). */
  private updateActiveSong(fn: (song: Song) => Song): boolean {
    const activeSong = this.host.activeSongById();
    if (!activeSong) {
      this.activeSectionId = null;
      return false; // no target: never retain or create an orphan active section
    }
    if (this.host.isViewer()) return false; // read-only viewer (S2): authoring no-op
    const id = this.host.activeSongId();
    if (!this.host.isLocalSong(id)) return false;
    const songs = this.host.songs();
    const localIndex = songs.findIndex((song) => song.id === id);
    if (localIndex < 0) return false; // resolved reference: section arrangement cannot write it yet
    const current = songs[localIndex]!;
    const next = fn(current);
    if (next === current) return false;
    this.host.recordUndo();
    this.host.setSongs(songs.map((song, index) => (index === localIndex ? next : song)));
    return true;
  }

  /** Reorder a section in the active song by drag/drop. */
  moveSection(sectionId: string, toIndex: number): void {
    this.updateActiveSong((song) => setlist.moveSection(song, sectionId, toIndex));
  }

  addSongSection(name: string): void {
    if (!this.host.activeSongById()) {
      this.activeSectionId = null;
      return; // no active song: no section and no active id
    }
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.host.isLocalSong(this.host.activeSongId())) return;
    const id = nid('section');
    if (!this.updateActiveSong((song) => setlist.addSection(song, setlist.makeSection(id, name)))) return;
    // The active song can change through a resolved/library boundary while the edit is
    // being applied. Only activate an id that exists in the post-edit song.
    if (this.host.activeSongById()?.sections.some((section) => section.id === id)) this.activeSectionId = id;
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
    const idx = (this.host.activeSongById()?.sections ?? []).findIndex((s) => s.id === sectionId);
    if (idx < 0) return; // not a section of the active song
    const wasActive = this.activeSectionId === sectionId;
    const changed = this.updateActiveSong((song) => setlist.removeSection(song, sectionId));
    if (changed && wasActive) {
      const remaining = this.host.activeSongById()?.sections ?? [];
      this.activeSectionId = (remaining[idx - 1] ?? remaining[0])?.id ?? null;
    }
  }

  /** Copy a section of the active song onto the clipboard as a detached deep copy, so later edits
      to the source never bleed into it. No-op if the id isn't a section of the active song. */
  copySection(sectionId: string): boolean {
    if (this.host.isViewer()) return false;
    if (!this.host.isLocalSong(this.host.activeSongId())) return false;
    const sec = this.host.activeSongById()?.sections.find((s) => s.id === sectionId);
    if (!sec) return false;
    // clone under its own id/name → a plain snapshot; pasteSection re-clones with a fresh id.
    this.sectionClipboard = setlist.cloneSection(sec, sec.id, sec.name);
    return true;
  }

  /** Paste the clipboard as a NEW section appended to the active song (fresh id, name
      "<name> copy"), and make it active. No-op when the clipboard is empty. */
  pasteSection(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): authoring no-op
    if (!this.host.isLocalSong(this.host.activeSongId())) return;
    const clip = this.sectionClipboard;
    if (!clip) return;
    const id = nid('section');
    if (!this.updateActiveSong((song) => setlist.addSection(song, setlist.cloneSection(clip, id)))) return;
    this.activeSectionId = id;
  }

  /** Duplicate a section in one step (copy + paste): appends an independent "<name> copy"
      after the song's sections and activates it. */
  duplicateSection(sectionId: string): void {
    if (this.copySection(sectionId)) this.pasteSection();
  }

  /** Append an already-built section object to the active song and make it active — the section
      insertion a system-clipboard (S44) paste performs after remapping it into this show. */
  insertSection(section: SetlistSection): boolean {
    if (!this.host.isLocalSong(this.host.activeSongId())) return false;
    if (!this.updateActiveSong((song) => setlist.addSection(song, section))) return false;
    this.activeSectionId = section.id;
    return true;
  }
}
