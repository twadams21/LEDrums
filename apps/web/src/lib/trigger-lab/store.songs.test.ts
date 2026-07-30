import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { STORAGE_KEY, serializeAuthored, type AuthoredState } from './persistence';
import type { WSClient } from '../ws/client';

/* Song CRUD on the SongRail: createSong / renameSong / duplicateSong / removeSong. The store
   seeds ONE song ('set-1'); these mutators add, rename, copy, and drop songs, re-point the
   active song after a delete, and persist via the authored-state autosave (verified by a
   serialize → re-construct "reload" round-trip, mirroring store.persistence.test.ts). */

import { MemStorage } from '../test-support/mem-storage';

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
    songs: store.library.songs,
    activeSongId: store.library.activeSongId,
    activeSectionId: store.arrangement.activeSectionId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(slice as AuthoredState)));
  return new TriggerLab(fakeClient);
}

describe('createSong', () => {
  it('appends a new auto-named song, activates it, and points at its first section', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.library.songs).toHaveLength(1);

    const id = store.library.createSong();
    const song = store.library.songs.find((s) => s.id === id)!;
    expect(store.library.songs).toHaveLength(2);
    expect(store.library.songs.at(-1)!.id).toBe(id); // appended
    expect(store.library.activeSongId).toBe(id); // activated
    expect(song.name).toBe('New song 1'); // auto-named
    expect(song.sections).toHaveLength(1); // one empty section
    expect(song.sections[0]!.graphs).toEqual([]);
    expect(store.arrangement.activeSectionId).toBe(song.sections[0]!.id); // active section re-pointed
  });

  it('honours an explicit name and auto-increments the default for the next unnamed song', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.library.createSong('Encore');
    const b = store.library.createSong();
    expect(store.library.songs.find((s) => s.id === a)!.name).toBe('Encore');
    expect(store.library.songs.find((s) => s.id === b)!.name).toBe('New song 1');
    expect(a).not.toBe(b);
  });

  it('persists the new song + active id across a reload', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.library.createSong('Persisted');
    const reloaded = reload(store);
    expect(reloaded.library.songs.some((s) => s.id === id && s.name === 'Persisted')).toBe(true);
    expect(reloaded.library.activeSongId).toBe(id);
  });
});

describe('renameSong', () => {
  it('updates the name and persists across a reload', () => {
    const store = new TriggerLab(fakeClient);
    store.library.renameSong('set-1', 'Main Set');
    expect(store.library.songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
    expect(reload(store).library.songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
  });

  it('ignores a blank rename (keeps the old name) and an unknown id (no throw)', () => {
    const store = new TriggerLab(fakeClient);
    store.library.renameSong('set-1', 'Main Set');
    store.library.renameSong('set-1', '   '); // blank → no-op
    store.library.renameSong('nope', 'X'); // unknown → no-op
    expect(store.library.songs.find((s) => s.id === 'set-1')!.name).toBe('Main Set');
    expect(store.library.songs).toHaveLength(1);
  });
});

describe('duplicateSong', () => {
  it('appends an independent "<name> copy", activates it, and reuses graph references', () => {
    const store = new TriggerLab(fakeClient);
    const newId = store.library.duplicateSong('set-1')!;
    const dup = store.library.songs.find((s) => s.id === newId)!;
    const src = store.library.songs.find((s) => s.id === 'set-1')!;

    expect(newId).not.toBe('set-1');
    expect(dup.name).toBe('Set 1 copy');
    expect(store.library.activeSongId).toBe(newId); // activated
    expect(dup.sections).toHaveLength(src.sections.length);
    expect(dup.sections[0]!.id).not.toBe(src.sections[0]!.id); // fresh section id
    expect(dup.sections[0]!.graphs).toEqual(src.sections[0]!.graphs); // same graph keys (reuse)
  });

  it('clones sections independently — editing the copy does not touch the source', () => {
    const store = new TriggerLab(fakeClient);
    const newId = store.library.duplicateSong('set-1')!;
    const dupSecId = store.library.songs.find((s) => s.id === newId)!.sections[0]!.id;
    const key = store.library.songs.find((s) => s.id === newId)!.sections[0]!.graphs[0]!;

    store.arrangement.removeGraphFromSection(dupSecId, key); // active song is the dup → edits the copy
    expect(store.library.songs.find((s) => s.id === newId)!.sections[0]!.graphs).not.toContain(key);
    expect(store.library.songs.find((s) => s.id === 'set-1')!.sections[0]!.graphs).toContain(key);
  });

  it('returns null for an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.library.duplicateSong('nope')).toBeNull();
    expect(store.library.songs).toHaveLength(1);
  });
});

describe('removeSong', () => {
  it('drops the song; deleting the ACTIVE song re-points to the next remaining song', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.library.createSong('B');
    const c = store.library.createSong('C'); // [set-1, B, C], active = C
    store.library.setActiveSong(b); // active = B (the middle song)

    store.library.removeSong(b);
    expect(store.library.songs.map((s) => s.id)).toEqual(['set-1', c]);
    expect(store.library.activeSongId).toBe(c); // re-pointed to the next song
    expect(store.library.activeSong!.id).toBe(c);
    expect(store.arrangement.activeSectionId).toBe(store.library.activeSong!.sections[0]!.id); // section re-pointed too
  });

  it('deleting the active LAST song re-points to the previous one', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.library.createSong('B'); // [set-1, B], active = B (last)
    store.library.removeSong(b);
    expect(store.library.songs.map((s) => s.id)).toEqual(['set-1']);
    expect(store.library.activeSongId).toBe('set-1');
  });

  it('leaves the active song alone when a different song is removed', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.library.createSong('B'); // [set-1, B], active = B
    store.library.removeSong('set-1'); // remove the non-active song
    expect(store.library.songs.map((s) => s.id)).toEqual([b]);
    expect(store.library.activeSongId).toBe(b); // unchanged
  });

  it('guards the last song (removing the only song is a no-op) and ignores unknown ids', () => {
    const store = new TriggerLab(fakeClient);
    store.library.removeSong('nope'); // unknown → no-op
    store.library.removeSong('set-1'); // last song → no-op (app always keeps one)
    expect(store.library.songs.map((s) => s.id)).toEqual(['set-1']);
    expect(store.library.activeSong).not.toBeNull();
  });

  it('persists the removal + re-pointed active id across a reload', () => {
    const store = new TriggerLab(fakeClient);
    const b = store.library.createSong('B'); // active = B
    store.library.removeSong('set-1'); // songs = [B], active stays B
    const reloaded = reload(store);
    expect(reloaded.library.songs.map((s) => s.id)).toEqual([b]);
    expect(reloaded.library.activeSongId).toBe(b);
  });
});
