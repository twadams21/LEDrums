import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSnapshotStore } from './snapshot-store';
import { writeFileAtomic } from '../atomic-file';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'ledrums-async-')); dirs.push(dir); return dir; }

describe('async snapshots', () => {
  it('captures before queueing, serializes writes, and shutdown waits while timers keep progressing', async () => {
    const dir = await directory();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const current = { project: { revision: 1 }, showLibrary: { version: 1, data: 'x'.repeat(4_000_000) }, songLibrary: null };
    let writing = 0, peak = 0, started = 0;
    const store = createSnapshotStore({ dir, now: () => 1000, readCurrent: () => current, applyRestored() {},
      write: async (path, data) => { writing++; peak = Math.max(peak, writing); started++; await gate; await writeFileAtomic(path, data); writing--; } });
    const first = store.snapshot('boot');
    current.project.revision = 2;
    const second = store.snapshot('pre-risk');
    current.project.revision = 3;
    const closed = store.close();
    const settled = vi.fn(); void closed.then(settled);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    await new Promise((r) => setTimeout(r, 80));
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
    expect(started).toBe(1);
    expect(settled).not.toHaveBeenCalled();
    release(); await closed;
    expect(peak).toBe(1);
    expect((await store.read((await first)!.id))!.files.project).toEqual({ revision: 1 });
    expect((await store.read((await second)!.id))!.files.project).toEqual({ revision: 2 });
    await expect(store.snapshot('boot')).rejects.toThrow('closed');
  });
  it('fails closed on injected ENOSPC and recovers for the next request', async () => {
    const dir = await directory();
    const apply = vi.fn();
    let fail = false;
    const store = createSnapshotStore({ dir, now: () => 1000,
      readCurrent: () => ({ project: {}, showLibrary: null, songLibrary: null }), applyRestored: apply, log() {},
      write: async (path, data) => { if (fail) throw new Error('ENOSPC'); await writeFileAtomic(path, data); } });
    const target = await store.snapshot('boot');
    fail = true;
    await expect(store.restore(target!.id)).rejects.toThrow('pre-risk');
    expect(apply).not.toHaveBeenCalled();
    fail = false;
    await store.restore(target!.id);
    expect(apply).toHaveBeenCalledOnce();
  });
  it('rejects path traversal, unsupported envelopes and mismatched metadata before safety/apply', async () => {
    const dir = await directory(); const apply = vi.fn();
    const store = createSnapshotStore({ dir, now: () => 1000,
      readCurrent: () => ({ project: {}, showLibrary: null, songLibrary: null }), applyRestored: apply, log() {} });
    await writeFile(join(dir, '1000-boot.json.gz'), await promisify(gzip)(JSON.stringify({ version: 99, files: {} })));
    expect(await store.restore('1000-boot')).toBeNull();
    expect(await store.read('../outside')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });
});
