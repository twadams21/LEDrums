import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  loadSongLibrary,
  inspectSongLibraryFile,
  saveSongLibrary,
  saveSongLibraryAsync,
  songLibraryPath,
  SONG_LIBRARY_FILE,
  type SongLibraryBlob,
} from './song-library';
import { SHOW_LIBRARY_FILE } from './show-library';

const tmp = mkdtempSync(join(tmpdir(), 'ledrums-songs-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A representative opaque song-library blob (the web's PersistedSongLibrary envelope shape). */
function sampleBlob(): SongLibraryBlob {
  return {
    version: 1,
    data: {
      songs: {
        'lib-1': { id: 'lib-1', name: 'Intro', sections: [], graphs: {}, graphNames: {}, effects: [], presets: [] },
      },
    },
  };
}

describe('song-library persistence', () => {
  it('uses its own file, distinct from the show library', () => {
    expect(SONG_LIBRARY_FILE).toBe('default.songs.local.json');
    expect(SONG_LIBRARY_FILE).not.toBe(SHOW_LIBRARY_FILE);
    expect(songLibraryPath(tmp)).toBe(join(tmp, SONG_LIBRARY_FILE));
  });

  it('round-trips save -> load, preserving the opaque blob verbatim', () => {
    const blob = sampleBlob();
    saveSongLibrary(blob, tmp);
    expect(existsSync(join(tmp, SONG_LIBRARY_FILE))).toBe(true);
    expect(loadSongLibrary(tmp)).toEqual(blob);
  });

  it('async save round-trips too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-songs-async-'));
    try {
      const blob = sampleBlob();
      await saveSongLibraryAsync(blob, dir);
      expect(loadSongLibrary(dir)).toEqual(blob);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads null in a fresh dir (boot falls back to "no library yet")', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ledrums-songs-fresh-'));
    try {
      expect(existsSync(join(fresh, SONG_LIBRARY_FILE))).toBe(false);
      expect(loadSongLibrary(fresh)).toBeNull();
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('returns null for a corrupt / non-envelope file instead of throwing (never wedges boot)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-songs-corrupt-'));
    try {
      writeFileSync(join(dir, SONG_LIBRARY_FILE), '{ not valid json', 'utf8');
      expect(loadSongLibrary(dir)).toBeNull();
      writeFileSync(join(dir, SONG_LIBRARY_FILE), JSON.stringify({ songs: {} }), 'utf8');
      expect(loadSongLibrary(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inspects absent, valid, corrupt, and non-envelope files for diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-songs-inspect-'));
    try {
      expect(inspectSongLibraryFile(dir)).toEqual({ path: join(dir, SONG_LIBRARY_FILE), source: 'absent' });
      saveSongLibrary(sampleBlob(), dir);
      expect(inspectSongLibraryFile(dir)).toEqual({ path: join(dir, SONG_LIBRARY_FILE), source: 'loaded' });
      writeFileSync(join(dir, SONG_LIBRARY_FILE), '{ not valid json', 'utf8');
      expect(inspectSongLibraryFile(dir)).toEqual({ path: join(dir, SONG_LIBRARY_FILE), source: 'invalid' });
      writeFileSync(join(dir, SONG_LIBRARY_FILE), JSON.stringify({ songs: {} }), 'utf8');
      expect(inspectSongLibraryFile(dir)).toEqual({ path: join(dir, SONG_LIBRARY_FILE), source: 'invalid' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists arbitrary nested data without interpreting it (server is opaque)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-songs-opaque-'));
    try {
      const blob: SongLibraryBlob = { version: 7, data: { anything: [1, { nested: true }], keys: 'kept' } };
      saveSongLibrary(blob, dir);
      expect(loadSongLibrary(dir)).toEqual(blob);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
