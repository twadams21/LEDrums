import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  loadShowLibrary,
  inspectShowLibraryFile,
  saveShowLibrary,
  saveShowLibraryAsync,
  SHOW_LIBRARY_FILE,
  type ShowLibraryBlob,
} from './show-library';
import { createAutosaver } from './autosave';

const tmp = mkdtempSync(join(tmpdir(), 'ledrums-shows-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A representative opaque library blob (the web's PersistedShowLibrary envelope shape). */
function sampleBlob(): ShowLibraryBlob {
  return {
    version: 1,
    data: {
      shows: {
        s1: { id: 's1', name: 'First', authored: { bpm: 128, graphs: {} } },
        s2: { id: 's2', name: 'Second', authored: { bpm: 90 } },
      },
      activeShowId: 's1',
    },
  };
}

describe('show-library persistence', () => {
  it('round-trips save -> load, preserving the opaque blob verbatim', () => {
    const blob = sampleBlob();
    saveShowLibrary(blob, tmp);
    expect(existsSync(join(tmp, SHOW_LIBRARY_FILE))).toBe(true);
    expect(loadShowLibrary(tmp)).toEqual(blob);
  });

  it('reports no library + loads null in a fresh dir (boot falls back to "no library yet")', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ledrums-shows-fresh-'));
    try {
      expect(existsSync(join(fresh, SHOW_LIBRARY_FILE))).toBe(false);
      expect(loadShowLibrary(fresh)).toBeNull();
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('returns null for a corrupt / non-envelope file instead of throwing (never wedges boot)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-shows-corrupt-'));
    try {
      writeFileSync(join(dir, SHOW_LIBRARY_FILE), '{ not valid json', 'utf8');
      expect(loadShowLibrary(dir)).toBeNull();
      // valid JSON but missing the version envelope → still rejected
      writeFileSync(join(dir, SHOW_LIBRARY_FILE), JSON.stringify({ shows: {} }), 'utf8');
      expect(loadShowLibrary(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inspects absent, valid, corrupt, and non-envelope library files for diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-shows-inspect-'));
    try {
      expect(inspectShowLibraryFile(dir)).toEqual({ path: join(dir, SHOW_LIBRARY_FILE), source: 'absent' });
      saveShowLibrary(sampleBlob(), dir);
      expect(inspectShowLibraryFile(dir)).toEqual({ path: join(dir, SHOW_LIBRARY_FILE), source: 'loaded' });
      writeFileSync(join(dir, SHOW_LIBRARY_FILE), '{ not valid json', 'utf8');
      expect(inspectShowLibraryFile(dir)).toEqual({ path: join(dir, SHOW_LIBRARY_FILE), source: 'invalid' });
      writeFileSync(join(dir, SHOW_LIBRARY_FILE), JSON.stringify({ shows: {} }), 'utf8');
      expect(inspectShowLibraryFile(dir)).toEqual({ path: join(dir, SHOW_LIBRARY_FILE), source: 'invalid' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists arbitrary nested data without interpreting it (server is opaque)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-shows-opaque-'));
    try {
      const blob: ShowLibraryBlob = { version: 7, data: { anything: [1, { deep: true }, null], n: 3 } };
      await saveShowLibraryAsync(blob, dir);
      expect(loadShowLibrary(dir)).toEqual(blob);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('atomic writes (temp + rename)', () => {
  it('saveShowLibrary leaves only the final file — no temp residue', () => {
    saveShowLibrary(sampleBlob(), tmp);
    expect(readdirSync(tmp).filter((f) => f.startsWith('default.shows'))).toEqual([SHOW_LIBRARY_FILE]);
  });

  it('saveShowLibraryAsync writes atomically and round-trips; overwrite leaves one file', async () => {
    await saveShowLibraryAsync(sampleBlob(), tmp);
    await saveShowLibraryAsync({ version: 1, data: { shows: {}, activeShowId: 'x' } }, tmp);
    expect(readdirSync(tmp).filter((f) => f.startsWith('default.shows'))).toEqual([SHOW_LIBRARY_FILE]);
    expect((loadShowLibrary(tmp)!.data as { activeShowId: string }).activeShowId).toBe('x');
  });
});

describe('autosave + boot-recover + shutdown-flush (mirrors the project autosaver)', () => {
  it('debounces a push, then a flush makes it durable and a reload restores it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-shows-autosave-'));
    try {
      let live: ShowLibraryBlob | null = null;
      const a = createAutosaver(() => (live ? saveShowLibraryAsync(live, dir) : Promise.resolve()), 10_000);
      live = sampleBlob();
      a.markDirty();
      expect(existsSync(join(dir, SHOW_LIBRARY_FILE))).toBe(false); // debounced (10s) — not on disk yet
      await a.flush(); // shutdown-flush forces the write
      expect(existsSync(join(dir, SHOW_LIBRARY_FILE))).toBe(true);
      expect(loadShowLibrary(dir)).toEqual(sampleBlob());
      a.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('coalesces a burst of pushes into one write of the latest blob', async () => {
    vi.useFakeTimers();
    try {
      // In-memory sink (no fs under fake timers): the save reads the live slot at call time,
      // so the autosaver's coalescing persists only the LATEST pushed blob.
      const writes: ShowLibraryBlob[] = [];
      let live: ShowLibraryBlob | null = null;
      const a = createAutosaver(() => {
        if (live) writes.push(live);
        return Promise.resolve();
      }, 400);
      live = { version: 1, data: { shows: {}, activeShowId: 'a' } };
      a.markDirty();
      live = { version: 1, data: { shows: {}, activeShowId: 'b' } };
      a.markDirty();
      await vi.advanceTimersByTimeAsync(400);
      expect(writes).toHaveLength(1); // one write for the burst
      expect((writes[0]!.data as { activeShowId: string }).activeShowId).toBe('b'); // the latest wins
      a.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
