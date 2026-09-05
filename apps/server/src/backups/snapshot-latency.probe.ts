/** Local-only operation/latency probe. No app boot, credentials or network adapters.
 * Run: pnpm --filter @ledrums/server exec node --expose-gc --import tsx src/backups/snapshot-latency.probe.ts */
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSnapshotStore } from './snapshot-store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0).toFixed(2);
  return { samples: values.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}
async function measure(operation: (captured: () => void) => Promise<void>) {
  globalThis.gc?.();
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  function sampleMemory() {
    const usage = process.memoryUsage();
    for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'] as const) peak[key] = Math.max(peak[key], usage[key]);
  }
  const gaps: number[] = [], queuedGaps: number[] = [];
  let queuedLast: number | null = null;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(); gaps.push(now - last); last = now;
    sampleMemory();
    if (queuedLast !== null) { queuedGaps.push(now - queuedLast); queuedLast = now; }
  }, 1);
  await sleep(20);
  const start = performance.now();
  await operation(() => { queuedLast = performance.now(); sampleMemory(); });
  const elapsedMs = performance.now() - start;
  sampleMemory();
  await sleep(20); clearInterval(timer);
  globalThis.gc?.();
  const retained = process.memoryUsage();
  const memory = Object.fromEntries((['rss', 'heapUsed', 'external', 'arrayBuffers'] as const).map((key) => [key, {
    baselineBytes: baseline[key], sampledPeakDeltaBytes: peak[key] - baseline[key], afterGcDeltaBytes: retained[key] - baseline[key],
  }]));
  return { elapsedMs: +elapsedMs.toFixed(2), timerGaps: summary(gaps), memory,
    ...(queuedGaps.length ? { postCaptureQueuedWorkTimerGaps: summary(queuedGaps) } : {}) };
}
async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'ledrums-snapshot-probe-'));
  try {
    // Deterministic, varied rows; avoid the misleading best-case compression of all-'x' data.
    const rows = Array.from({ length: 45_000 }, (_, i) => ({ id: `graph-${i}`, params: {
      hue: (i * 137) % 360, brightness: (i % 100) / 100, speed: i % 17 },
      nodes: ['trigger', 'effect', 'output'], name: `Fixture ${i} / ${(i * 2654435761) >>> 0}` }));
    const files = { project: { revision: 0 }, showLibrary: { version: 1, data: rows }, songLibrary: null };
    const bytes = Buffer.byteLength(JSON.stringify(files));
    const count = 8;
    const sync = await measure(async () => {
      for (let i = 0; i < count; i++) {
        files.project.revision = i;
        writeFileSync(join(dir, `sync-${i}.gz`), gzipSync(JSON.stringify({ version: 1, files })));
      }
    });
    const store = createSnapshotStore({ dir: join(dir, 'async'), now: () => 1000, readCurrent: () => files, applyRestored() {} });
    const submissionMs: number[] = [];
    const queued = await measure(async (captured) => {
      const pending = Array.from({ length: count }, (_, i) => {
        files.project.revision = i;
        const start = performance.now(); const work = store.snapshot('pre-risk');
        submissionMs.push(performance.now() - start); return work;
      });
      captured();
      await Promise.all(pending); await store.close();
    });
    const serializationMs: number[] = [];
    const serializationOnly = await measure(async () => {
      for (let i = 0; i < count; i++) {
        const start = performance.now(); JSON.stringify(files); serializationMs.push(performance.now() - start);
      }
    });
    console.log(JSON.stringify({ node: process.version, bytes, count, explicitGc: !!globalThis.gc,
      capturedQueuePayloadUtf8Bytes: bytes * count, synchronousBaseline: sync,
      queuedCompressionAndAtomicWrite: queued, synchronousSubmission: summary(submissionMs),
      serializationOnly: { ...serializationOnly, perCall: summary(serializationMs) },
      limitations: 'Synthetic 1ms timer with memory sampling, not MIDI-to-light. Memory is sampled process usage, not total allocations; peaks during blocking work can be missed. Queue payload bytes are UTF-8 equivalents, not V8 string storage. stringify/parse and optional offsite enqueue remain main-thread. No fsync/power-loss guarantee.' }, null, 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
void main();
