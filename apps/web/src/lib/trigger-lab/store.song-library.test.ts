import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { buildShow } from './show-builder';
import { SONGS_STORAGE_KEY, serializeSongLibrary, type SongLibrary } from './persistence';
import type { LibrarySong } from './store/song-library';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage, OutputStatus, SerializedModel } from '../ws/protocol-types';

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

/** A minimal, valid pool song under `id` (empty closure — enough to reserve its id). */
const libSong = (id: string): LibrarySong => ({ id, name: id, sections: [], graphs: {}, graphNames: {}, effects: [], presets: [] });
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

describe('referenced songs are navigable + playable + editable (S42 consumption)', () => {
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

  it('editing a referenced graph writes through to the LIBRARY copy; authored state keeps the ref (no copy)', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);

    // a referenced graph carrying a play node (keys are namespaced `lib:<libId>/…`)
    const libGraphs = store.songLibrary.songs[libId]!.graphs;
    const refKey = Object.keys(libGraphs).find((k) => libGraphs[k]!.nodes.some((n) => n.kind === 'effect'))!;
    expect(refKey).toBeTruthy();

    // edit via the EXACT path the Trigger editor uses: select the graph, mutate a play node's param
    store.selectedPadKey = refKey;
    const play = store.selectedGraph!.nodes.find((n) => n.kind === 'effect')!;
    play.params = { ...play.params, __s42probe: 0.4242 };

    // the canonical LIBRARY copy changed (S41 aliasing — resolved holds the library rune's proxies)
    const libPlay = store.songLibrary.songs[libId]!.graphs[refKey]!.nodes.find((n) => n.kind === 'effect')!;
    expect((libPlay.params as Record<string, number>).__s42probe).toBe(0.4242);

    // …and the show did NOT absorb a copy: authored graphs stay local-only; the show still holds a REF
    expect(store.graphs[refKey]).toBeUndefined();
    expect(store.songRefs).toEqual([libId]);
  });

  it('buildShow carries a referenced song + its namespaced graphs (engine push; passes integrity)', () => {
    const store = new TriggerLab(fakeClient);
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);
    store.setActiveSong(libId);

    // the resolved show source is what syncShowToServer sends — building it must NOT throw on the
    // `lib:<id>/…` graph keys (core integrity exempts them) and must include the referenced content.
    const show = buildShow({
      buses: store.buses,
      graphs: store.resolvedView.graphs,
      sections: store.sections,
      effects: store.resolvedView.effects,
      presets: store.resolvedView.presets,
      drums: store.drums,
      songs: store.resolvedSongs,
    });
    expect(show.songs?.some((s) => s.id === libId)).toBe(true);
    const refKey = Object.keys(store.songLibrary.songs[libId]!.graphs)[0]!;
    expect(show.graphs[refKey]).toBeDefined();
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
      h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, null, blob, null);
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
