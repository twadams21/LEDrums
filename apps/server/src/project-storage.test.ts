import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectStorage, LIVE_STATE_FILE } from './project-storage';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(join(tmpdir(), 'ledrums-state-')); dirs.push(p); return p; }

describe('atomic live-state envelope', () => {
  it('commits all blobs in FIFO order, captures revisions, and round-trips null on restart', async () => {
    const path = await dir(); const storage = createProjectStorage(path);
    expect(await storage.read()).toBeNull();
    const files = { project: { revision: 0 }, showLibrary: null, songLibrary: null };
    const pending = Array.from({ length: 20 }, (_, revision) => {
      files.project.revision = revision; return storage.save(files);
    });
    files.project.revision = 999;
    await Promise.all(pending); await storage.drain();
    expect(await createProjectStorage(path).read()).toEqual({ project: { revision: 19 }, showLibrary: null, songLibrary: null });
    expect(await readdir(path)).toEqual([LIVE_STATE_FILE]);
  });
  it('never silently falls back to stale separate files when the authority is corrupt', async () => {
    const path = await dir(); const storage = createProjectStorage(path);
    await writeFile(join(path, LIVE_STATE_FILE), '{bad');
    await expect(storage.read()).rejects.toThrow();
    await writeFile(join(path, LIVE_STATE_FILE), JSON.stringify({ version: 2, files: {} }));
    await expect(storage.read()).rejects.toThrow('Invalid live-state');
  });

  describe('old-format library archive', () => {
    const v2Shows = { version: 2, data: { shows: { a: { authored: { graphs: {} } } }, activeShowId: 'a' } };
    const v3Shows = { version: 3, data: { shows: {}, activeShowId: null } };
    const v1Songs = { version: 1, data: { songs: { s: { id: 's' } } } };
    const v2Songs = { version: 2, data: { songs: {} } };
    const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

    it('archives a stored v2 show / v1 song library exactly once when a newer format replaces it', async () => {
      const path = await dir();
      const first = createProjectStorage(path);
      await first.save({ project: { n: 1 }, showLibrary: v2Shows, songLibrary: v1Songs });
      await first.save({ project: { n: 2 }, showLibrary: v2Shows, songLibrary: v1Songs });
      expect(await readdir(path)).toEqual([LIVE_STATE_FILE]);

      await first.save({ project: { n: 3 }, showLibrary: v3Shows, songLibrary: v2Songs });
      await first.save({ project: { n: 4 }, showLibrary: v3Shows, songLibrary: v2Songs });
      expect((await readdir(path)).sort()).toEqual(['default.shows.v2.local.json', 'default.songs.v1.local.json', LIVE_STATE_FILE].sort());
      expect(await readJson(join(path, 'default.shows.v2.local.json'))).toEqual(v2Shows);
      expect(await readJson(join(path, 'default.songs.v1.local.json'))).toEqual(v1Songs);
      expect((await readJson(join(path, LIVE_STATE_FILE))).files).toEqual({ project: { n: 4 }, showLibrary: v3Shows, songLibrary: v2Songs });
    });

    it('archives the blob found on disk after a restart, and never overwrites an existing archive', async () => {
      const path = await dir();
      await createProjectStorage(path).save({ project: {}, showLibrary: v2Shows, songLibrary: null });
      const existing = { version: 2, data: { original: true } };
      await writeFile(join(path, 'default.shows.v2.local.json'), JSON.stringify(existing));

      // A fresh process that writes before (or without) reading still sees what is on disk.
      const restarted = createProjectStorage(path);
      await restarted.save({ project: {}, showLibrary: v3Shows, songLibrary: null });
      expect(await readJson(join(path, 'default.shows.v2.local.json'))).toEqual(existing);
      expect((await readdir(path)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('does not archive a same-version, older-version or null-slot write', async () => {
      const path = await dir();
      const storage = createProjectStorage(path);
      expect(await storage.read()).toBeNull();
      await storage.save({ project: {}, showLibrary: v3Shows, songLibrary: null });
      await storage.save({ project: {}, showLibrary: v2Shows, songLibrary: null });
      await storage.save({ project: {}, showLibrary: null, songLibrary: null });
      await storage.save({ project: {}, showLibrary: v3Shows, songLibrary: v2Songs });
      expect(await readdir(path)).toEqual([LIVE_STATE_FILE]);
    });
  });
});
