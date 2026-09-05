import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
});
