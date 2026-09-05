import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { createSnapshotStore, type SnapshotStore, type SnapshotStoreDeps } from './snapshot-store';
import { writeFileAtomic } from '../atomic-file';
import { createProjectReplacement } from '../project-replacement';
import { EngineHost } from '../engine-host';
import { OutputManager } from '../output-manager';

const stores: SnapshotStore[] = [], dirs: string[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map(s => s.close()));
  await Promise.all(dirs.splice(0).map(d => rm(d, { force: true, recursive: true })));
});
async function make(options: Partial<SnapshotStoreDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ledrums-worker-test-')); dirs.push(dir);
  const s = createSnapshotStore({ dir, now: () => 1000, readCurrent: () => ({ project: {}, showLibrary: null, songLibrary: null }), applyRestored() {}, log() {}, ...options });
  stores.push(s); return { s, dir };
}
function gate() { let release!: () => void; const ready = new Promise<void>(r => { release = r; }); return { ready, release }; }

describe('bounded worker snapshot owner', () => {
  it('never stringifies snapshot JSON on the calling thread; a read parses its validated text exactly once on main', async () => {
    const current = { project: { marker: 'p11-offthread-marker' }, showLibrary: null, songLibrary: null };
    const { s } = await make({ readCurrent: () => current });
    const stringify = vi.spyOn(JSON, 'stringify');
    const work = s.snapshot('boot');
    const capturedOnMain = stringify.mock.calls.some(args => args[0] === current);
    stringify.mockRestore();
    const meta = await work;
    expect(capturedOnMain).toBe(false);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect((await s.read(meta!.id))!.files).toEqual(current);
      // Deliberate boundary (P1 depth fix): the worker validates envelope + budget and returns
      // TEXT; the iterative main-thread parse replaces a recursive structured clone of the object.
      expect(parse.mock.calls.filter(args => String(args[0]).includes('p11-offthread-marker'))).toHaveLength(1);
    } finally { parse.mockRestore(); }
  });
  it('refuses admission before readCurrent/clone, preserves both revisions, then retries', async () => {
    const blocked = gate(), entered = gate();
    const current = { project: { revision: 1 }, showLibrary: null, songLibrary: null };
    const readCurrent = vi.fn(() => current);
    const { s } = await make({ readCurrent, write: async (path, data) => { entered.release(); await blocked.ready; await writeFileAtomic(path, data); } });
    const first = s.snapshot('pre-risk'); current.project.revision = 2;
    const second = s.snapshot('pre-risk'); current.project.revision = 3;
    try {
      await expect(s.snapshot('pre-risk')).rejects.toMatchObject({ code: 'busy' });
      expect(readCurrent).toHaveBeenCalledTimes(2);
      await entered.ready;
    } finally { blocked.release(); }
    const a = await first, b = await second;
    expect(a!.id).not.toBe(b!.id);
    expect((await s.read(a!.id))!.files.project).toEqual({ revision: 1 });
    expect((await s.read(b!.id))!.files.project).toEqual({ revision: 2 });
    expect(await s.snapshot('pre-risk')).not.toBeNull();
  });
  it('recovers cadence digest after reopening and never coalesces pre-risk checkpoints', async () => {
    const { s, dir } = await make(); await s.snapshot('boot'); await s.close();
    const { s: reopened } = await make({ dir });
    expect(await reopened.snapshot('cadence')).toBeNull();
    await reopened.snapshot('pre-risk'); await reopened.snapshot('pre-risk');
    expect(await reopened.list()).toHaveLength(3);
  });
  it('FIFO restore captures each intervening revision without safety queue recursion; close drains both', async () => {
    let current = { project: { revision: 1 }, showLibrary: null, songLibrary: null };
    const applied: unknown[] = [];
    const { s, dir } = await make({ readCurrent: () => current, applyRestored: files => { applied.push(files.project); current = files as typeof current; } });
    const a = await s.snapshot('boot'); current.project.revision = 2;
    const b = await s.snapshot('boot'); current.project.revision = 3;
    const first = s.restore(a!.id), second = s.restore(b!.id);
    await expect(s.restore(a!.id)).rejects.toMatchObject({ code: 'busy' });
    await s.close(); await Promise.all([first, second]);
    expect(applied).toEqual([{ revision: 1 }, { revision: 2 }]);
    const { s: reopened } = await make({ dir });
    const safety = (await reopened.list()).filter(m => m.reason === 'pre-risk');
    expect(safety).toHaveLength(2);
    expect((await reopened.read(safety[0]!.id))!.files.project).toEqual({ revision: 1 });
    expect((await reopened.read(safety[1]!.id))!.files.project).toEqual({ revision: 3 });
  });
  it('settles captured-but-queued work on worker loss behind slow disk, drains, and retries', async () => {
    const blocked = gate(), entered = gate(); let worker!: Worker;
    const { s } = await make({ serializer: { createWorker(source, limits) { return worker = new Worker(source, { eval: true, workerData: limits, execArgv: [] }); } },
      write: async (path, data) => { entered.release(); await blocked.ready; await writeFileAtomic(path, data); } });
    const first = s.snapshot('boot'), second = s.snapshot('pre-risk');
    const settled = Promise.allSettled([first, second]);
    await entered.ready;
    await worker.terminate(); blocked.release();
    const outcomes = await settled; await s.drain();
    expect(outcomes.map(x => x.status)).toEqual(['fulfilled', 'rejected']);
    expect(await s.snapshot('pre-risk')).not.toBeNull();
  });
  it('close settles accepted failures and joins a nonresponsive worker without hanging the queue', async () => {
    const workers: Worker[] = [];
    const { s } = await make({ serializer: { limits: { timeoutMs: 100 }, createWorker() {
      const w = new Worker("require('node:worker_threads').parentPort.on('message', () => {});", { eval: true, execArgv: [] }); workers.push(w); return w;
    } } });
    const pending = s.snapshot('pre-risk');
    const outcome = Promise.allSettled([pending]);
    await s.close(); await s.drain();
    expect((await outcome)[0]?.status).toBe('rejected');
    expect(workers.every(w => w.threadId === -1)).toBe(true);
    await expect(s.snapshot('pre-risk')).rejects.toMatchObject({ code: 'closed' });
  });
  it('fails oversized restore decoding before safety/apply, caps read concurrency and joins reads on close', async () => {
    const apply = vi.fn();
    const { s, dir } = await make({ applyRestored: apply, serializer: { limits: { maxJsonBytes: 100 } } });
    await writeFile(join(dir, '1000-boot.json.gz'), gzipSync(JSON.stringify({ version: 1, createdAt: 1000, reason: 'boot', files: { project: 'x'.repeat(2000), showLibrary: null, songLibrary: null } })));
    const a = s.read('1000-boot'), b = s.read('1000-boot');
    await expect(s.read('1000-boot')).rejects.toMatchObject({ code: 'busy' });
    expect(await a).toBeNull(); expect(await b).toBeNull();
    expect(await s.restore('1000-boot')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    const read = s.read('1000-boot'); await s.close(); expect(await read).toBeNull();
  });
  it('a deep (3,000-level) but valid, in-budget snapshot reads back; offsite handoff cannot fail the local write', async () => {
    // Exact P1/P2 counterexamples: decoded objects crossing the worker boundary overflowed the
    // structured-clone stack, so a SUCCESSFUL safety snapshot returned null on read, and the
    // optional onSnapshot bundle preparation failed the pack BEFORE the local write.
    let nested: unknown = 0; for (let i = 0; i < 3000; i++) nested = { x: nested };
    const p = defaultProject(); p.name = 'before'; p.output.state = 'disabled';
    const files = { project: p, showLibrary: null, songLibrary: { version: 1, data: { songs: {}, extra: nested } } };
    const handoff = vi.fn();
    for (const onSnapshot of [undefined, handoff]) {
      const { s } = await make({ readCurrent: () => files, onSnapshot });
      const meta = await s.snapshot('pre-risk');
      expect(meta).not.toBeNull();
      expect(await s.list()).toHaveLength(1);
      const bundle = await s.read(meta!.id);
      expect(bundle).not.toBeNull();
      expect(bundle!.files.project).toEqual(p);
      expect(JSON.stringify(bundle!.files.songLibrary)).toBe(JSON.stringify(files.songLibrary));
      // The local write also covers a restore: the safety checkpoint is the deep fixture itself.
      expect(await s.restore(meta!.id)).toEqual(meta);
    }
    expect(handoff).toHaveBeenCalledTimes(2); // snapshot + restore's pre-risk on the offsite store
    expect(handoff.mock.calls[0]![1].files.project.name).toBe('before');
  });
  it('offsite handoff receives the call-time revision even when the live source mutates, and its failure is isolated', async () => {
    const p = defaultProject(); p.name = 'call-time'; p.output.state = 'disabled';
    const files = { project: p, showLibrary: null, songLibrary: null };
    const seen: string[] = [];
    const { s } = await make({ readCurrent: () => files, onSnapshot: (_m, bundle) => { seen.push((bundle.files.project as { name: string }).name); throw new Error('offsite down'); } });
    const work = s.snapshot('boot');
    p.name = 'mutated-after-call';
    expect(await work).not.toBeNull();
    expect(seen).toEqual(['call-time']);
    expect(await s.list()).toHaveLength(1);
  });
  it.each(['busy', 'oversize', 'worker'] as const)('actual named-load coordinator aborts on %s safety refusal before persistence/live commit', async fault => {
    const p = defaultProject(); p.output.state = 'disabled'; p.name = 'old';
    const host = new EngineHost(p, new OutputManager(() => { throw new Error('Output forbidden'); }));
    const readCurrent = () => ({ project: host.engine.getProject(), showLibrary: null, songLibrary: null });
    const blocked = gate(), entered = gate();
    const { s } = await make({ readCurrent, admission: { maxPendingSnapshots: 1 },
      serializer: fault === 'oversize' ? { limits: { maxJsonBytes: 10 } } : fault === 'worker' ? { createWorker: () => new Worker("throw new Error('crash')", { eval: true, execArgv: [] }) } : undefined,
      write: async (path, data) => { entered.release(); await blocked.ready; await writeFileAtomic(path, data); } });
    const persist = vi.fn(), broadcastState = vi.fn(), commitLibraries = vi.fn();
    const replacement = createProjectReplacement({ host, voiceHost: null, readCurrent,
      safetySnapshot: async () => await s.snapshot('pre-risk') !== null,
      flushAutosaves: async () => {}, persist, broadcastState, commitLibraries });
    const pending = fault === 'busy' ? s.snapshot('boot') : null;
    try {
      if (pending) await entered.ready;
      const next = structuredClone(p); next.name = 'new';
      await expect(replacement.load(next)).rejects.toMatchObject({ code: fault });
      expect(host.engine.getProject().name).toBe('old');
      expect(persist).not.toHaveBeenCalled(); expect(broadcastState).not.toHaveBeenCalled(); expect(commitLibraries).not.toHaveBeenCalled();
    } finally { blocked.release(); await pending; await replacement.close(); await host.stop(); }
  });
});
