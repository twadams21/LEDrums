import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

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
