import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { STORAGE_KEY, serializeAuthored, type AuthoredState } from './persistence';
import type { WSClient } from '../ws/client';

/* Song CRUD on the SongRail: createSong / renameSong / duplicateSong / removeSong. The store
   seeds ONE song ('set-1'); these mutators add, rename, copy, and drop songs, re-point the
   active song after a delete, and persist via the authored-state autosave (verified by a
   serialize → re-construct "reload" round-trip, mirroring store.persistence.test.ts). */

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** Simulate a reload: persist the store's songs + active ids the way the autosave would,
    then construct a fresh store that hydrates them. */
function reload(store: TriggerLab): TriggerLab {
  const slice: Partial<AuthoredState> = {
    songs: store.songs,
    activeSongId: store.activeSongId,
    activeSectionId: store.activeSectionId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(slice as AuthoredState)));
  return new TriggerLab(fakeClient);
}

describe('createSong', () => {
  it('appends a new auto-named song, activates it, and points at its first section', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.songs).toHaveLength(1);

    const id = store.createSong();
    const song = store.songs.find((s) => s.id === id)!;
    expect(store.songs).toHaveLength(2);
    expect(store.songs.at(-1)!.id).toBe(id); // appended
    expect(store.activeSongId).toBe(id); // activated
    expect(song.name).toBe('New song 1'); // auto-named
    expect(song.sections).toHaveLength(1); // one empty section
    expect(song.sections[0]!.graphs).toEqual([]);
    expect(store.activeSectionId).toBe(song.sections[0]!.id); // active section re-pointed
  });

  it('honours an explicit name and auto-increments the default for the next unnamed song', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.createSong('Encore');
    const b = store.createSong();
    expect(store.songs.find((s) => s.id === a)!.name).toBe('Encore');
    expect(store.songs.find((s) => s.id === b)!.name).toBe('New song 1');
    expect(a).not.toBe(b);
  });

  it('persists the new song + active id across a reload', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.createSong('Persisted');
    const reloaded = reload(store);
    expect(reloaded.songs.some((s) => s.id === id && s.name === 'Persisted')).toBe(true);
    expect(reloaded.activeSongId).toBe(id);
  });
});

describe('renameSong', () => {
  it('updates the name and persists across a reload', () => {
    const store = new TriggerLab(fakeClient);
    store.renameSong('set-1', 'Main Set');
    expect(store.songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
    expect(reload(store).songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
  });

  it('ignores a blank rename (keeps the old name) and an unknown id (no throw)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameSong('set-1', 'Main Set');
    store.renameSong('set-1', '   '); // blank → no-op
    store.renameSong('nope', 'X'); // unknown → no-op
    expect(store.songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
    expect(store.songs).toHaveLength(1);
  });
});

describe('duplicateSong', () => {
  it('appends an independent "<name> copy", activates it, and reuses graph references', () => {
    const store = new TriggerLab(fakeClient);
    const newId = store.duplicateSong('set-1')!;
    const dup = store.songs.find((s) => s.id === newId)!;
    const src = store.songs.find((s) => s.id === 'set-1')!;

    expect(newId).not.toBe('set-1');
    expect(dup.name).toBe('Set 1 copy');
    expect(store.activeSongId).toBe(newId); // activated
    expect(dup.sections).toHaveLength(src.sections.length);
    expect(dup.sections[0]!.id).not.toBe(src.sections[0]!.id); // fresh section id
    expect(dup.sections[0]!.graphs).toEqual(src.sections[0]!.graphs); // same graph keys (reuse)
  });

  it('clones sections independently — editing the copy does not touch the source', () => {
    const store = new TriggerLab(fakeClient);
    const newId = store.duplicateSong('set-1')!;
    const dupSecId = store.songs.find((s) => s.id === newId)!.sections[0]!.id;
    const key = store.songs.find((s) => s.id === newId)!.sections[0]!.graphs[0]!;

    store.removeGraphFromSection(dupSecId, key); // active song is the dup → edits the copy
    expect(store.songs.find((s) => s.id === newId)!.sections[0]!.graphs).not.toContain(key);
    expect(store.songs.find((s) => s.id === 'set-1')!.sections[0]!.graphs).toContain(key);
  });

  it('returns null for an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.duplicateSong('nope')).toBeNull();
    expect(store.songs).toHaveLength(1);
  });
});

describe('removeSong', () => {
  it('drops the song; deleting the ACTIVE song re-points to the next remaining song', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.createSong('B');
    const c = store.createSong('C'); // [set-1, B, C], active = C
    store.setActiveSong(b); // active = B (the middle song)

    store.removeSong(b);
    expect(store.songs.map((s) => s.id)).toEqual(['set-1', c]);
    expect(store.activeSongId).toBe(c); // re-pointed to the next song
    expect(store.activeSong!.id).toBe(c);
    expect(store.activeSectionId).toBe(store.activeSong!.sections[0]!.id); // section re-pointed too
  });

  it('deleting the active LAST song re-points to the previous one', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.createSong('B'); // [set-1, B], active = B (last)
    store.removeSong(b);
    expect(store.songs.map((s) => s.id)).toEqual(['set-1']);
    expect(store.activeSongId).toBe('set-1');
  });

  it('leaves the active song alone when a different song is removed', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.createSong('B'); // [set-1, B], active = B
    store.removeSong('set-1'); // remove the non-active song
    expect(store.songs.map((s) => s.id)).toEqual([b]);
    expect(store.activeSongId).toBe(b); // unchanged
  });

  it('guards the last song (removing the only song is a no-op) and ignores unknown ids', () => {
    const store = new TriggerLab(fakeClient);
    store.removeSong('nope'); // unknown → no-op
    store.removeSong('set-1'); // last song → no-op (app always keeps one)
    expect(store.songs.map((s) => s.id)).toEqual(['set-1']);
    expect(store.activeSong).not.toBeNull();
  });

  it('persists the removal + re-pointed active id across a reload', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.createSong('B'); // active = B
    store.removeSong('set-1'); // songs = [B], active stays B
    const reloaded = reload(store);
    expect(reloaded.songs.map((s) => s.id)).toEqual([b]);
    expect(reloaded.activeSongId).toBe(b);
  });
});
