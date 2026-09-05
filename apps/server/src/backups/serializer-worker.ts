import { Worker } from 'node:worker_threads';
import type { SnapshotBundle, SnapshotFiles, SnapshotMeta } from './snapshot-store';

/** Agent-selected defaults, not a pre-clone heap/byte guarantee. Limits apply after stringify
 * inside the worker; the store separately caps accepted captures BEFORE postMessage. */
export const DEFAULT_SERIALIZER_LIMITS = {
  maxJsonBytes: 32 * 1024 * 1024,
  maxRetainedJsonBytes: 64 * 1024 * 1024,
  maxPendingRequests: 8,
  timeoutMs: 30_000,
};
export type SerializerLimits = typeof DEFAULT_SERIALIZER_LIMITS;
export class SnapshotRefusal extends Error {
  constructor(public readonly code: 'busy' | 'oversize' | 'closed' | 'worker', message: string) {
    super(message); this.name = 'SnapshotRefusal';
  }
}

// Deliberately literal JS, NOT function.toString(): esbuild may insert closure helpers in a
// serialized function. eval + builtin requires works in source, CJS bundles AND Node SEA, with
// no external worker file, loader, native addon or runtime dependency to package.
export const SERIALIZER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { open } = require('node:fs/promises');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const limits = workerData;
const captures = new Map();
let retained = 0;
const hash = text => createHash('sha256').update(text).digest('hex');
function oversize() { const e = new Error('Snapshot exceeds serializer JSON byte budget'); e.code = 'oversize'; throw e; }
function drop(key) {
  const capture = captures.get(key);
  if (capture) { retained -= capture.bytes; captures.delete(key); }
  return capture;
}
async function readBundle(path, id) {
  const file = await open(path, 'r');
  let data;
  try {
    if ((await file.stat()).size > limits.maxJsonBytes + 65536) oversize();
    // Bounded read even if the file grows after stat. One extra byte detects the overflow.
    const chunks = []; let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, limits.maxJsonBytes + 65537 - size));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); size += bytesRead;
      if (size > limits.maxJsonBytes + 65536) oversize();
    }
    data = Buffer.concat(chunks, size);
  } finally { await file.close(); }
  const text = gunzipSync(data, { maxOutputLength: limits.maxJsonBytes + 1024 }).toString('utf8');
  const b = JSON.parse(text);
  if (!b || b.version !== 1 || !b.files || typeof b.files !== 'object'
    || !('project' in b.files) || !('showLibrary' in b.files) || !('songLibrary' in b.files)
    || b.createdAt + '-' + b.reason !== id) throw new Error('Invalid snapshot envelope');
  if (Buffer.byteLength(JSON.stringify(b.files)) > limits.maxJsonBytes) oversize();
  return b;
}
async function execute(m) {
  switch (m.op) {
    case 'capture': {
      // Undefined slots disappear in JSON and would create an unreadable safety checkpoint.
      if (!m.files || Object.getPrototypeOf(m.files) !== Object.prototype
        || ['project', 'showLibrary', 'songLibrary'].some(key => m.files[key] === undefined)) {
        throw new Error('Invalid snapshot files: all three JSON slots are required');
      }
      const text = JSON.stringify(m.files);
      const bytes = Buffer.byteLength(text);
      if (bytes > limits.maxJsonBytes || retained + bytes > limits.maxRetainedJsonBytes) oversize();
      captures.set(m.key, { text, bytes }); retained += bytes;
      return { digest: hash(text), bytes };
    }
    case 'release': drop(m.key); return null;
    case 'pack': {
      const capture = drop(m.key);
      if (!capture) throw new Error('Snapshot capture lost (worker restarted); retry the operation');
      const text = '{"version":1,"createdAt":' + m.meta.createdAt
        + ',"reason":' + JSON.stringify(m.meta.reason) + ',"files":' + capture.text + '}';
      const compressed = gzipSync(text);
      // Transfer an exact-sized standalone allocation; never clone a pooled Buffer slab.
      const bytes = new Uint8Array(compressed.length); bytes.set(compressed);
      return { compressed: bytes, bundle: m.withBundle ? JSON.parse(text) : undefined };
    }
    case 'read': return readBundle(m.path, m.snapshotId);
    case 'digest': return hash(JSON.stringify((await readBundle(m.path, m.snapshotId)).files));
    default: throw new Error('Unknown serializer operation');
  }
}
// Serialize even asynchronous file reads; there is no concurrent unbounded gunzip/parse backlog.
let tail = Promise.resolve();
parentPort.on('message', m => {
  tail = tail.then(async () => {
    try {
      const value = await execute(m);
      parentPort.postMessage({ id: m.id, value }, value?.compressed ? [value.compressed.buffer] : []);
    } catch (e) { parentPort.postMessage({ id: m.id, error: { code: e.code, message: String(e.message || e) } }); }
  });
});
`;

type Request =
  | { op: 'capture'; key: number; files: SnapshotFiles }
  | { op: 'pack'; key: number; meta: SnapshotMeta; withBundle: boolean }
  | { op: 'release'; key: number }
  | { op: 'read' | 'digest'; path: string; snapshotId: string };
interface Reply { id: number; value?: unknown; error?: { code?: string; message: string } }
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

export interface SerializerOptions {
  limits?: Partial<SerializerLimits>;
  /** Fault-injection seam. Production always uses the self-contained source above. */
  createWorker?: (source: string, limits: SerializerLimits) => Worker;
}

export function createSnapshotSerializer(options: SerializerOptions = {}) {
  const limits = { ...DEFAULT_SERIALIZER_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid serializer limit: ${key}`);
  }
  let worker: Worker | undefined;
  let closed = false, sequence = 0, captureKey = 0;
  const pending = new Map<number, Pending>();
  const terminating = new Set<Promise<number>>();
  function terminate(w: Worker) {
    const done = w.terminate(); terminating.add(done);
    void done.then(() => terminating.delete(done), () => terminating.delete(done));
  }
  function fail(w: Worker, error: Error) {
    if (worker !== w) return;
    worker = undefined;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear(); terminate(w);
  }
  function start(): Worker {
    if (worker) return worker;
    const w = options.createWorker?.(SERIALIZER_WORKER_SOURCE, limits) ?? new Worker(SERIALIZER_WORKER_SOURCE, {
      eval: true, workerData: limits, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker = w;
    w.on('message', (reply: Reply) => {
      if (worker !== w) return;
      const p = pending.get(reply.id);
      if (!p) { fail(w, new SnapshotRefusal('worker', 'Invalid serializer response')); return; }
      clearTimeout(p.timer); pending.delete(reply.id);
      if (!pending.size) w.unref();
      if (reply.error) p.reject(new SnapshotRefusal(reply.error.code === 'oversize' ? 'oversize' : 'worker', reply.error.message));
      else p.resolve(reply.value);
    });
    w.on('error', (e) => fail(w, new SnapshotRefusal('worker', `Snapshot worker failed: ${e.message}`)));
    w.on('messageerror', (e) => fail(w, new SnapshotRefusal('worker', `Snapshot worker decode failed: ${e.message}`)));
    w.on('exit', (code) => fail(w, new SnapshotRefusal('worker', `Snapshot worker exited (${code}); retry the operation`)));
    w.unref();
    return w;
  }
  function request<T>(message: Request): Promise<T> {
    if (closed) return Promise.reject(new SnapshotRefusal('closed', 'Snapshot serializer is closed'));
    if (pending.size >= limits.maxPendingRequests) return Promise.reject(new SnapshotRefusal('busy', 'Snapshot serializer is busy; retry the operation'));
    // Promise executor runs immediately: structured clone completes BEFORE this method returns.
    return new Promise<T>((resolve, reject) => {
      const w = start(), id = ++sequence;
      const timer = setTimeout(() => fail(w, new SnapshotRefusal('worker', 'Snapshot worker timed out; retry the operation')), limits.timeoutMs);
      pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      w.ref();
      try { w.postMessage({ ...message, id }); }
      catch (error) {
        pending.delete(id); clearTimeout(timer); if (!pending.size) w.unref();
        reject(error);
      }
    });
  }
  return {
    capture(files: SnapshotFiles) {
      const key = ++captureKey;
      return { key, ready: request<{ digest: string; bytes: number }>({ op: 'capture', key, files }) };
    },
    pack: (key: number, meta: SnapshotMeta, withBundle: boolean) => request<{ compressed: Uint8Array; bundle?: SnapshotBundle }>({ op: 'pack', key, meta, withBundle }),
    async release(key: number) {
      try { return await request<null>({ op: 'release', key }); }
      catch (error) {
        // Even a custom transport cap must not strand worker-held JSON on a failed cleanup RPC.
        // Resetting fails other captures explicitly; their owners can retry, never commit uncovered.
        if (worker) fail(worker, new SnapshotRefusal('worker', 'Snapshot capture cleanup failed; retry the operation'));
        throw error;
      }
    },
    read: (path: string, snapshotId: string) => request<SnapshotBundle>({ op: 'read', path, snapshotId }),
    digest: (path: string, snapshotId: string) => request<string>({ op: 'digest', path, snapshotId }),
    /** Immediate cancellation settles every RPC, then joins every retiring worker. Owner drains
     * accepted store operations first for graceful close; tests may cancel to exercise failure. */
    async dispose() {
      closed = true;
      if (worker) fail(worker, new SnapshotRefusal('closed', 'Snapshot serializer disposed'));
      await Promise.allSettled([...terminating]);
    },
  };
}
