import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import {
  SONGS_V2_STORAGE_KEY as SONGS_STORAGE_KEY,
  serializeSongLibraryV2 as serializeSongLibrary,
  type EffectLibrarySong,
  type SongLibraryV2 as SongLibrary,
} from './persistence';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage, OscListenInfo, OutputStatus, SerializedModel } from '../ws/protocol-types';

/* Song library on the store (S41): export a local song into the canonical pool, reference it from
   a show (resolve materializes it into the runtime view), canonical propagation across shows, detach
   to a local copy, the delete-in-use guard, and the pool's own persistence round-trip. The pure
   resolve/detach/CRUD/guard contract is covered in store/song-library-refs.test.ts. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

/** A WSClient that captures the callbacks the store registers, so a test can drive onState. */
const harnessClient =
  (h: { cb: WSCallbacks | null }): (() => WSClient) =>
  () =>
    ({ on(cb: WSCallbacks) { h.cb = cb; }, connect() {}, close() {}, send(_m: ClientMessage) {} }) as unknown as WSClient;

const MODEL: SerializedModel = { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } };
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 };
const OSC_LISTEN: OscListenInfo = { status: 'listening', port: 9000, hosts: ['192.168.1.20'] };

/** A minimal, valid pool song under `id` (no sections — enough to reserve its id). */
const libSong = (id: string): EffectLibrarySong => ({ id, name: id, sections: [] });
const suffix = (id: string): number => Number(id.split('-')[1]);

function withRaf(fn: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    fn();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('export → import → resolve', () => {
  it('exports a local song into the pool and materializes it in the referencing show’s runtime view', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1'); // the seed song
    expect(libId).toBeTruthy();
    expect(store.songLibraryList.map((s) => s.id)).toEqual([libId]);

    // referencing it makes the song appear in the resolved view (not the raw authored songs)
    expect(store.songs.some((s) => s.id === libId)).toBe(false);
    store.importSongReference(libId!);
    expect(store.songRefs).toEqual([libId]);
    expect(store.resolvedSongs.some((s) => s.id === libId)).toBe(true);

    // the resolved view is renderable: the referenced song's section graphs are all present
    const refSong = store.resolvedSongs.find((s) => s.id === libId)!;
    for (const sec of refSong.sections) for (const key of sec.graphs) expect(store.resolvedView.graphs[key]).toBeDefined();
  });

  it('import is a no-op for an unknown library id or an already-referenced one', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference('nope');
    expect(store.songRefs).toEqual([]);
    store.importSongReference(libId);
    store.importSongReference(libId); // idempotent
    expect(store.songRefs).toEqual([libId]);
  });
});

describe('canonical propagation + detach', () => {
  it('renaming the library song propagates to every referencing show; detach isolates', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;

    // show A references it
    const showA = store.activeShowId;
    store.importSongReference(libId);

    // show B references the SAME library song
    const showB = store.newShow('B');
    store.importSongReference(libId);

    // edit the one canonical copy → both shows' resolved views update
    store.renameLibrarySong(libId, 'Canonical Name');
    expect(store.resolvedSongs.find((s) => s.id === libId)!.name).toBe('Canonical Name');
    store.openShow(showA);
    expect(store.resolvedSongs.find((s) => s.id === libId)!.name).toBe('Canonical Name');

    // detach in A → a local copy, the ref is dropped, and a later library rename no longer reaches A
    const localId = store.detachSongReference(libId)!;
    expect(localId).toBeTruthy();
    expect(store.songRefs).toEqual([]); // ref severed in A
    expect(store.songs.some((s) => s.id === localId)).toBe(true); // now a local song
    store.renameLibrarySong(libId, 'Changed Again');
    expect(store.resolvedSongs.some((s) => s.id === libId)).toBe(false); // A no longer references it
    // …but show B still does, and still tracks the library
    store.openShow(showB);
    expect(store.resolvedSongs.find((s) => s.id === libId)!.name).toBe('Changed Again');
  });
});

describe('referenced songs are navigable + playable but read-only (S42 consumption)', () => {
  it('a referenced song is a valid active song, and its sections resolve', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);

    // it is NOT a local song, yet setActiveSong accepts it (reads the resolved list)
    expect(store.songs.some((s) => s.id === libId)).toBe(false);
    store.setActiveSong(libId);
    expect(store.activeSongId).toBe(libId);
    expect(store.activeSong?.id).toBe(libId);
    expect(store.activeSong!.sections.length).toBeGreaterThan(0);
    expect(store.activeSection).toBeTruthy(); // its first section became active (playable)
  });

  it('Effect mutators are no-ops on a referenced song; authored state and library stay unchanged', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);
    store.setActiveSong(libId);

    const section = store.activeSection!;
    expect(section.id.startsWith(`lib:${libId}/`)).toBe(true); // namespaced section ids
    const effect = section.effects![0]!;
    const beforeLibrary = JSON.stringify(store.songLibrary.songs[libId]);
    const beforeSongs = JSON.stringify(store.songs);
    expect(store.canEditActiveSong).toBe(false);
    // By design the store's own canEdit is viewer-only (its app callers' rule), so it reads true
    // here; the Effects contract's canEdit lives on store.effectsApi and reads false.
    expect(store.canEdit).toBe(true);
    expect(store.effectsApi.canEdit).toBe(false);

    expect(store.addEffect({ row: 'kick', column: { kind: 'zone', slot: 0 } }, 'solid')).toBeNull();
    store.setEffectOpacity(effect.id, 0.01);
    store.setGeneratorParam(effect.id, 'color', '#000000');
    store.removeEffect(effect.id);
    store.addModifier(effect.id, 'strobe');
    store.clearCell(effect.cell);

    expect(JSON.stringify(store.songLibrary.songs[libId])).toBe(beforeLibrary);
    expect(JSON.stringify(store.songs)).toBe(beforeSongs); // the show did NOT absorb a copy
    expect(store.effectById(effect.id)).toEqual(effect);
    expect(store.undo()).toBe(false);
    expect(store.songRefs).toEqual([libId]);
  });

  it('the Effects API reports canEdit false on a referenced song and for a viewer, true on a local song', () => {
    const store = new TriggerLab(fakeClient);
    const localSongId = store.activeSongId;
    expect(store.effectsApi.canEdit).toBe(true);

    const libId = store.exportSongToLibrary(localSongId)!;
    store.importSongReference(libId);
    store.setActiveSong(libId);
    expect(store.activeSection).toBeTruthy();
    expect(store.effectsApi.canEdit).toBe(false);

    store.setActiveSong(localSongId);
    expect(store.effectsApi.canEdit).toBe(true);

    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    expect(store.isViewer).toBe(true);
    expect(store.effectsApi.canEdit).toBe(false);
  });

  it('allows a referenced cell only as a copy source that creates local content', () => {
    const store = new TriggerLab(fakeClient);
    const localSongId = store.activeSongId;
    const libraryId = store.exportSongToLibrary(localSongId)!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const cell = store.activeSection!.effects![0]!.cell;
    const beforeLibrary = JSON.stringify(store.songLibrary.songs[libraryId]);

    store.copyCell(cell); // reading is allowed on a read-only song
    expect(store.canPasteCell).toBe(false); // …but not pasting into it
    expect(store.pasteCell(cell).ok).toBe(false);

    store.setActiveSong(localSongId);
    const localSection = store.activeSection!;
    const before = localSection.effects!.length;
    expect(store.pasteCell(cell)).toEqual({ ok: true });
    expect(store.activeSection!.effects).toHaveLength(before + 1);
    expect(JSON.stringify(store.songLibrary.songs[libraryId])).toBe(beforeLibrary);
  });

  it('the engine Show carries a referenced song + its Effects (setShow on connect)', () => {
    const sent: ClientMessage[] = [];
    let cb: WSCallbacks | null = null;
    withRaf(() => {
      const store = new TriggerLab(() => ({ on(c: WSCallbacks) { cb = c; }, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient);
      store.start();
      const libId = store.exportSongToLibrary('set-1')!;
      store.importSongReference(libId);
      cb!.onConnection!('open');
      const setShow = sent.find((m) => m.t === 'setShow');
      const show = setShow?.t === 'setShow' ? setShow.show : null;
      const ref = show?.songs?.find((s) => s.id === libId);
      expect(ref).toBeDefined();
      const librarySection = store.songLibrary.songs[libId]!.sections[0]!;
      expect(ref!.sections[0]!.id).toBe(librarySection.id);
      expect(ref!.sections[0]!.effects?.map((e) => e.id)).toEqual(librarySection.effects.map((e) => e.id));
      store.stop();
    });
  });

  it('removeSongReference drops the ref WITHOUT cloning (the inverse of import)', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);
    expect(store.resolvedSongs.some((s) => s.id === libId)).toBe(true);

    store.removeSongReference(libId);
    expect(store.songRefs).toEqual([]);
    expect(store.resolvedSongs.some((s) => s.id === libId)).toBe(false); // left the resolved view
    expect(store.songs.some((s) => s.id === libId)).toBe(false); // NOT cloned into local songs
    expect(store.songLibrary.songs[libId]).toBeTruthy(); // the library copy is untouched
  });

  it('reconciles an active reference removal and does not revive its section when re-added', () => {
    const store = new TriggerLab(fakeClient);
    const localSong = store.songs[0]!;
    const libId = store.exportSongToLibrary(localSong.id)!;
    store.importSongReference(libId);
    store.setActiveSong(libId);
    const referencedSectionId = store.activeSectionId;

    store.removeSongReference(libId);

    expect(store.activeSongId).toBe(localSong.id);
    expect(store.activeSongById?.id).toBe(localSong.id);
    expect(store.activeSectionId).toBe(localSong.sections[0]!.id);
    expect(store.activeSectionId).not.toBe(referencedSectionId);

    store.importSongReference(libId);

    expect(store.activeSongId).toBe(localSong.id);
    expect(store.activeSectionId).toBe(localSong.sections[0]!.id);
  });

  it('keeps an active reference cleared when removal leaves no fallback song', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);
    store.setActiveSong(libId);
    store.songs = [];

    store.removeSongReference(libId);

    expect(store.activeSongId).toBe('');
    expect(store.activeSongById).toBeNull();
    expect(store.activeSectionId).toBeNull();

    store.importSongReference(libId);

    expect(store.activeSongId).toBe('');
    expect(store.activeSectionId).toBeNull();
  });
});

describe('delete-in-use guard', () => {
  it('blocks deleting a referenced library song and reports the using shows', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.renameShow(store.activeShowId, 'Main Show');
    store.importSongReference(libId);

    const usedBy = store.deleteLibrarySong(libId);
    expect(usedBy).toEqual([{ id: store.activeShowId, name: 'Main Show' }]);
    expect(store.songLibraryList.map((s) => s.id)).toEqual([libId]); // still present

    // drop the reference → now deletable
    store.detachSongReference(libId);
    expect(store.deleteLibrarySong(libId)).toEqual([]);
    expect(store.songLibraryList).toEqual([]);
  });
});

describe('pool-id reservation (no collision with local song mints)', () => {
  // Pool ids share the global `song-N` counter with local songs; a restored/adopted pool id must
  // be reserved so a later local mint can't reuse it (which would duplicate an id in resolvedSongs).
  // The pool id is chosen far above any counter value a test process reaches, so the next mint's
  // number exceeds it ONLY because the reserve advanced the counter — without the fix the counter
  // stays small and the mint's number would NOT exceed the pool id.
  it('reserves a RESTORED pool id at boot', () => {
    const POOL = 'song-2000000000';
    localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify(serializeSongLibrary({ songs: { [POOL]: libSong(POOL) } } as SongLibrary)));
    const store = new TriggerLab(fakeClient);
    expect(store.songLibraryList.map((s) => s.id)).toEqual([POOL]);
    const local = store.createSong('Local');
    expect(local).not.toBe(POOL);
    expect(suffix(local)).toBeGreaterThan(2_000_000_000); // counter advanced past the pool id
  });

  it('reserves an ADOPTED pool id (server cold-load)', () => {
    const POOL = 'song-3000000000';
    const h: { cb: WSCallbacks | null } = { cb: null };
    withRaf(() => {
      const store = new TriggerLab(harnessClient(h));
      store.start(); // attaches the WS callbacks
      const blob = serializeSongLibrary({ songs: { [POOL]: libSong(POOL) } } as SongLibrary);
      h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, null, blob, null, OSC_LISTEN);
      expect(store.songLibraryList.map((s) => s.id)).toEqual([POOL]); // adopted
      const local = store.createSong('Local');
      expect(suffix(local)).toBeGreaterThan(3_000_000_000); // counter advanced past the adopted id
      store.stop();
    });
  });
});

describe('song-library persistence (autosave → reload)', () => {
  it('persists the canonical pool + a show’s references across a reload', () => {
    let libId = '';
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      libId = store.exportSongToLibrary('set-1')!;
      store.importSongReference(libId);
      store.stop(); // flush song library + show library → localStorage
    });

    const reloaded = new TriggerLab(fakeClient);
    expect(reloaded.songLibraryList.map((s) => s.id)).toEqual([libId]); // pool restored
    expect(reloaded.songRefs).toEqual([libId]); // the active show's reference restored
    expect(reloaded.resolvedSongs.some((s) => s.id === libId)).toBe(true); // resolves after reload
  });
});
