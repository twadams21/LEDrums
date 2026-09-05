import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createSnapshotSerializer, type SerializerOptions } from './serializer-worker';

const serializers: ReturnType<typeof createSnapshotSerializer>[] = [];
function make(options: SerializerOptions = {}) {
  const s = createSnapshotSerializer(options); serializers.push(s); return s;
}
afterEach(async () => { await Promise.all(serializers.splice(0).map(s => s.dispose())); });
const files = () => ({ project: { revision: 1 }, showLibrary: null, songLibrary: null });
const meta = { id: '1000-boot', createdAt: 1000, reason: 'boot' as const };

describe('real inline serializer worker', () => {
  it('does not keep an otherwise idle CLI alive', async () => {
    // Intentionally no dispose in this CHILD: the OS ends its idle unref worker with the CLI.
    // Explicit owner disposal/join is verified below and all in-process tests close their stores.
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `import { createSnapshotSerializer } from './src/backups/serializer-worker.ts';
       const s = createSnapshotSerializer();
       const c = s.capture({project:{},showLibrary:null,songLibrary:null}); await c.ready;
       await s.release(c.key); console.log('idle-exit');`], { timeout: 8000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LEDRUMS_TELEMETRY: 'off' } });
    expect(stdout.trim()).toBe('idle-exit');
  });
  it('captures call-time values and parses off-thread for the optional off-site handoff', async () => {
    const s = make(), current = files();
    const capture = s.capture(current); current.project.revision = 2;
    expect((await capture.ready).digest).toHaveLength(64);
    const packed = await s.pack(capture.key, meta, true);
    expect(JSON.parse(packed.text!).files.project).toEqual({ revision: 1 });
    expect(packed.compressed).toBeInstanceOf(Uint8Array);
  });
  it('refuses bytes after clone, frees aggregate reservations on release, and permits retry', async () => {
    const s = make({ limits: { maxJsonBytes: 100, maxRetainedJsonBytes: 100 } });
    await expect(s.capture({ ...files(), showLibrary: '🪘'.repeat(40) }).ready).rejects.toMatchObject({ code: 'oversize' });
    const one = s.capture(files()); await one.ready;
    await expect(s.capture(files()).ready).rejects.toMatchObject({ code: 'oversize' });
    await s.release(one.key);
    const two = s.capture(files()); await two.ready;
    expect(await s.pack(two.key, meta, false)).not.toHaveProperty('text', expect.anything());
  });
  it('settles synchronous clone errors and asynchronous stringify errors without poisoning later work', async () => {
    const s = make();
    await expect(s.capture({ ...files(), songLibrary: () => {} }).ready).rejects.toThrow();
    await expect(s.capture({ ...files(), songLibrary: 1n }).ready).rejects.toThrow();
    await expect(s.capture({ ...files(), songLibrary: undefined }).ready).rejects.toThrow('all three JSON slots');
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(s.capture({ ...files(), songLibrary: cyclic }).ready).rejects.toThrow(/circular/i);
    await expect(s.capture(files()).ready).resolves.toHaveProperty('digest');
  });
  it.each(['error', 'exit'] as const)('settles every in-flight RPC on worker %s, starts a fresh worker on retry', async (fault) => {
    let starts = 0;
    const s = make({ createWorker(source, limits) {
      starts++;
      return new Worker(starts === 1 ? `require('node:worker_threads').parentPort.once('message', () => { ${fault === 'error' ? "throw new Error('injected crash')" : 'process.exit(0)'}; });` : source,
        { eval: true, workerData: limits, execArgv: [] });
    } });
    const a = s.capture(files()), b = s.capture(files());
    const failed = await Promise.allSettled([a.ready, b.ready]);
    expect(failed.map(x => x.status)).toEqual(['rejected', 'rejected']);
    const retry = s.capture(files()); await retry.ready;
    await expect(s.pack(retry.key, meta, true)).resolves.toHaveProperty('text');
    expect(starts).toBe(2);
  });
  it('bounds transport admission before clone and times out a hung worker', async () => {
    const s = make({ limits: { maxPendingRequests: 1, timeoutMs: 100 },
      createWorker: () => new Worker("require('node:worker_threads').parentPort.on('message', () => {});", { eval: true, execArgv: [] }) });
    const first = s.capture(files());
    let touched = false;
    const refused = s.capture({ ...files(), get songLibrary() { touched = true; return null; } });
    await expect(refused.ready).rejects.toMatchObject({ code: 'busy' });
    expect(touched).toBe(false);
    await expect(first.ready).rejects.toThrow('timed out');
  });
  it('disposal rejects outstanding work, joins the worker and is idempotent', async () => {
    let worker: Worker | undefined;
    const s = make({ createWorker(source, limits) { return worker = new Worker(source, { eval: true, workerData: limits, execArgv: [] }); } });
    const capture = s.capture(files());
    const settled = Promise.allSettled([capture.ready]);
    await s.dispose(); await s.dispose();
    expect((await settled)[0]?.status).toBe('rejected');
    expect(worker?.threadId).toBe(-1);
    await expect(s.capture(files()).ready).rejects.toMatchObject({ code: 'closed' });
  });
});
