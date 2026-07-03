import { describe, it, expect } from 'vitest';
import { SongLibrarySync } from './song-library-sync';
import { serializeSongLibrary, type SongLibrary } from '../persistence';
import type { LibrarySong } from './song-library';

const song = (id: string): LibrarySong => ({
  id,
  name: id,
  sections: [],
  graphs: {},
  graphNames: {},
  effects: [],
  presets: [],
});

const lib = (...ids: string[]): SongLibrary => ({ songs: Object.fromEntries(ids.map((id) => [id, song(id)])) });

/** The opaque wire/state payload the server rebroadcasts (a serialized envelope). */
const raw = (l: SongLibrary): unknown => serializeSongLibrary(l);

describe('SongLibrarySync — cold-load adopt (editor / standalone)', () => {
  it('adopts the server library once when there is nothing local to lose', () => {
    const sync = new SongLibrarySync();
    sync.markServerStateSeen();
    const plan = sync.planReconcile(raw(lib('lib-1')), false, false);
    expect(plan).toEqual({ kind: 'adopt', library: lib('lib-1') });
  });

  it('seeds (keeps freshest local content) when local exists', () => {
    const sync = new SongLibrarySync();
    expect(sync.planReconcile(raw(lib('server')), true, false)).toEqual({ kind: 'seed' });
  });

  it('seeds when the server has no usable library', () => {
    const sync = new SongLibrarySync();
    expect(sync.planReconcile(null, false, false)).toEqual({ kind: 'seed' });
  });

  it('never clobbers after the first sync (noop on later states)', () => {
    const sync = new SongLibrarySync();
    sync.noteSynced(sync.librarySig(lib('lib-1')));
    expect(sync.planReconcile(raw(lib('other')), false, false)).toEqual({ kind: 'noop' });
  });
});

describe('SongLibrarySync — viewer live-follow', () => {
  it('adopts a differing server library, ignores its own echo', () => {
    const sync = new SongLibrarySync();
    // follow a change
    expect(sync.planFollow(raw(lib('a')))).toEqual({ kind: 'adopt', library: lib('a') });
    // once synced to it, the same library is an echo → noop
    sync.noteSynced(sync.librarySig(lib('a')));
    expect(sync.planFollow(raw(lib('a')))).toEqual({ kind: 'noop' });
    // a genuinely different library is adopted
    expect(sync.planFollow(raw(lib('a', 'b')))).toEqual({ kind: 'adopt', library: lib('a', 'b') });
  });

  it('a viewer reconcile routes through follow (adopts every changed state, never seeds)', () => {
    const sync = new SongLibrarySync();
    expect(sync.planReconcile(raw(lib('x')), true, true)).toEqual({ kind: 'adopt', library: lib('x') });
    expect(sync.planReconcile('junk', false, true)).toEqual({ kind: 'noop' });
  });
});

describe('SongLibrarySync — push gating', () => {
  it('does not push before the first server state is seen', () => {
    const sync = new SongLibrarySync();
    expect(sync.planPush(serializeSongLibrary(lib('lib-1')))).toBe(false);
  });

  it('pushes a changed envelope once, suppresses an unchanged repeat', () => {
    const sync = new SongLibrarySync();
    sync.markServerStateSeen();
    const env = serializeSongLibrary(lib('lib-1'));
    expect(sync.planPush(env)).toBe(true);
    expect(sync.planPush(env)).toBe(false); // unchanged → suppressed
    expect(sync.planPush(serializeSongLibrary(lib('lib-1', 'lib-2')))).toBe(true); // changed → push
  });
});
