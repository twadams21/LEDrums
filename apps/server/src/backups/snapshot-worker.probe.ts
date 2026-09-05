/** Offline timer/memory probe; no server, output, credentials or network.
 * P11_BASELINE_MODULE points at the esbuild CJS bundle of snapshot-store.ts from 0c25083d.
 * Run with pinned Node --expose-gc --import tsx (or bundle as an actual SEA).
 */
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSnapshotStore, type SnapshotStore, type SnapshotStoreDeps } from './snapshot-store';
import { createProjectStorage } from '../project-storage';
import { isSea } from 'node:sea';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0).toFixed(2);
  return { samples: values.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: at(1) };
}
async function measure(operation: (submitted: () => void) => Promise<void>) {
  globalThis.gc?.();
  const baseline = process.memoryUsage(), peak = { ...baseline };
  const sample = () => {
    const usage = process.memoryUsage();
    for (const key of ['rss', 'heapUsed', 'arrayBuffers'] as const) peak[key] = Math.max(peak[key], usage[key]);
  };
  const gaps: number[] = [], workGaps: number[] = [];
  let last = performance.now(), workLast: number | undefined;
  const timer = setInterval(() => {
    const now = performance.now(); gaps.push(now - last); last = now; sample();
    if (workLast !== undefined) { workGaps.push(now - workLast); workLast = now; }
  }, 1);
  await sleep(20); const start = performance.now();
  try {
    await operation(() => { workLast = performance.now(); sample(); });
    const elapsedMs = +(performance.now() - start).toFixed(2);
    await sleep(20); sample(); globalThis.gc?.();
    const after = process.memoryUsage();
    return { elapsedMs, timerGaps: summary(gaps), postSubmissionGaps: summary(workGaps),
      memory: Object.fromEntries((['rss', 'heapUsed', 'arrayBuffers'] as const).map(key => [key,
        { sampledPeakDeltaBytes: peak[key] - baseline[key],
          [globalThis.gc ? 'afterGcDeltaBytes' : 'afterObservationDeltaBytes']: after[key] - baseline[key] }])) };
  } finally { clearInterval(timer); }
}
async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'ledrums-p11-probe-'));
  const stores: SnapshotStore[] = [];
  try {
    const rows = Array.from({ length: 45_000 }, (_, i) => ({ id: `graph-${i}`, params: {
      hue: (i * 137) % 360, brightness: (i % 100) / 100, speed: i % 17 },
      nodes: ['trigger', 'effect', 'output'], name: `Fixture ${i} / ${(i * 2654435761) >>> 0}` }));
    const files = { project: { revision: 0 }, showLibrary: { version: 1, data: rows }, songLibrary: null };
    const bytes = Buffer.byteLength(JSON.stringify(files)), count = 8;
    const output: Record<string, unknown> = { node: process.version, sea: isSea(), bytes, attempts: count, explicitGc: !!globalThis.gc };
    const create = (name: string, factory = createSnapshotStore, admission?: SnapshotStoreDeps['admission']) => {
      const s = factory({ dir: join(dir, name), now: () => 1000, readCurrent: () => files, applyRestored() {}, admission });
      stores.push(s); return s;
    };
    async function burst(s: SnapshotStore) {
      const submissionMs: number[] = [], acceptedSubmissionMs: number[] = [];
      let outcomes: PromiseSettledResult<unknown>[] = [];
      const result = await measure(async submitted => {
        const pending = Array.from({ length: count }, (_, i) => {
          files.project.revision = i;
          const start = performance.now(), work = s.snapshot('pre-risk');
          submissionMs.push(performance.now() - start); return work;
        });
        const settled = Promise.allSettled(pending); submitted(); outcomes = await settled; await s.drain();
      });
      outcomes.forEach((x, i) => { if (x.status === 'fulfilled' && x.value) acceptedSubmissionMs.push(submissionMs[i]!); });
      return { ...result, submission: summary(submissionMs), acceptedSubmission: summary(acceptedSubmissionMs),
        accepted: acceptedSubmissionMs.length, refused: outcomes.filter(x => x.status === 'rejected').length };
    }
    if (process.env.P11_BASELINE_MODULE) {
      const require = createRequire(join(dir, 'probe.cjs'));
      const baseline = require(process.env.P11_BASELINE_MODULE) as { createSnapshotStore: typeof createSnapshotStore };
      const before = create('before', baseline.createSnapshotStore);
      output.beforeExact0c25083d = await burst(before);
      const target = (await before.list())[0]!;
      output.beforeRead = await measure(async submitted => { const read = before.read(target.id); submitted(); await read; });
    }
    const s = create('worker');
    // Cold includes startup; the second burst reuses the SAME persistent worker.
    output.workerDefaultColdBurst = await burst(s);
    output.workerDefaultWarmBurst = await burst(s);
    // Equal accepted work: cap 8 is a diagnostic opt-in, not production admission. It separates
    // worker capture improvement from the default's six cheap refusals in an 8-at-once burst.
    const eight = create('worker-eight', createSnapshotStore, { maxPendingSnapshots: 8 });
    output.workerEightAcceptedBurst = await burst(eight);
    const submission: number[] = [];
    output.workerEightPaced = await measure(async submitted => {
      for (let i = 0; i < count; i++) {
        files.project.revision = i;
        const start = performance.now(), work = s.snapshot('pre-risk'); submission.push(performance.now() - start);
        submitted(); await work;
      }
    });
    output.workerEightPacedSubmission = summary(submission);
    const target = (await s.list())[0]!;
    output.workerRead = await measure(async submitted => { const read = s.read(target.id); submitted(); await read; });
    const storage = createProjectStorage(join(dir, 'storage'));
    const storageSubmission: number[] = [];
    output.unchangedAtomicStorageBoundary = await measure(async submitted => {
      const start = performance.now(), save = storage.save(files); storageSubmission.push(performance.now() - start);
      submitted(); await save;
    });
    output.unchangedAtomicStorageSubmission = summary(storageSubmission);
    output.unchangedAtomicStorageRead = await measure(async submitted => { const read = storage.read(); submitted(); await read; });
    output.limitations = '1ms synthetic timers and sampled process memory, not frame/MIDI-to-light SLA or allocation totals. Structured clone is synchronous and count-capped, NOT pre-clone byte-bounded. Worker JSON budgets apply post-clone/stringify. Read result cloning/deserialization still costs main-thread time. Atomic project storage and off-site queue serialization remain outside this backup-worker seam. Eight-accepted burst is diagnostic configuration, not production default.';
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await Promise.all(stores.map(s => s.close()));
    await rm(dir, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
