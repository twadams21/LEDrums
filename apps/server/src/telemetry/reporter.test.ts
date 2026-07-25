import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MonitorEvent } from '../ws-protocol';
import { createReporter } from './reporter';
import type { Envelope, ReportOrigin, ReportRecord } from './envelope';
import { createShipQueue, type ShipQueue } from './ship-queue';

/** A fake queue capturing every enqueued record (the Reporter's only real output). */
function fakeQueue(): ShipQueue<ReportRecord> & { enqueued: ReportRecord[] } {
  const enqueued: ReportRecord[] = [];
  return {
    enqueued,
    enqueue: (r) => enqueued.push(r),
    flush: () => Promise.resolve(),
    persistSync: () => {},
    size: () => enqueued.length,
    dropped: () => 0,
    items: () => enqueued,
    dispose: () => {},
  };
}

const envelope = (origin: ReportOrigin): Envelope => ({
  machine: 'rig-1',
  version: '1.2.3',
  engineMode: 'voice',
  platform: 'darwin',
  osRelease: '24.0.0',
  session: 'sess-1',
  uptimeMs: 5000,
  origin,
});

let clock = 1000;
function reporter(queue = fakeQueue()) {
  clock = 1000;
  const r = createReporter({ queue, envelope, now: () => clock, breadcrumbLimit: 20 });
  return { r, queue };
}

const ev = (over: Partial<MonitorEvent>): MonitorEvent => ({
  id: 1,
  time: 100,
  type: 'system',
  direction: 'local',
  source: 'server',
  label: 'evt',
  ...over,
});

const errorEv = (over: Partial<MonitorEvent>): MonitorEvent =>
  ev({ type: 'error', source: 'web', label: 'boom', ...over });

describe('createReporter (#122)', () => {
  it('turns an error event into one report with envelope + count 1', () => {
    const { r, queue } = reporter();
    r.observe(errorEv({ source: 'web', label: 'boom', detail: 'Error: boom\n    at f (a.js:1:1)' }));
    expect(queue.enqueued).toHaveLength(1);
    const rec = queue.enqueued[0]!;
    expect(rec).toMatchObject({ message: 'boom', count: 1, firstSeenMs: 1000, lastSeenMs: 1000 });
    expect(rec.envelope.origin).toBe('web');
    expect(rec.stack).toBe('Error: boom\n    at f (a.js:1:1)');
  });

  it('bumps count on a repeat of the same dedup key (breadcrumbs kept from first occurrence)', () => {
    const { r, queue } = reporter();
    const stack = 'Error: boom\n    at f (a.js:1:1)';
    r.observe(ev({ type: 'input', source: 'ws', label: 'midi' })); // a breadcrumb
    r.observe(errorEv({ label: 'boom', detail: stack }));
    clock = 2000;
    r.observe(errorEv({ label: 'boom', detail: stack }));
    expect(queue.enqueued).toHaveLength(2);
    expect(queue.enqueued[1]).toMatchObject({ count: 2, firstSeenMs: 1000, lastSeenMs: 2000 });
    // same breadcrumbs both times (the input before the first occurrence)
    expect(queue.enqueued[1]!.breadcrumbs.map((b) => b.label)).toEqual(['midi']);
  });

  it('distinguishes different throw sites into separate reports', () => {
    const { r, queue } = reporter();
    r.observe(errorEv({ label: 'boom', detail: 'Error: boom\n    at f (a.js:1:1)' }));
    r.observe(errorEv({ label: 'boom', detail: 'Error: boom\n    at g (b.js:2:2)' }));
    expect(queue.enqueued).toHaveLength(2);
    expect(queue.enqueued[0]!.count).toBe(1);
    expect(queue.enqueued[1]!.count).toBe(1);
  });

  it('attaches the preceding bus events as breadcrumbs (last 20, in order, before the fault)', () => {
    const { r, queue } = reporter();
    for (let i = 0; i < 25; i++) r.observe(ev({ type: 'system', label: `e${i}` }));
    r.observe(errorEv({ label: 'fault', detail: undefined }));
    const crumbs = queue.enqueued[0]!.breadcrumbs;
    expect(crumbs).toHaveLength(20);
    expect(crumbs[0]!.label).toBe('e5'); // last 20 of e0..e24
    expect(crumbs.at(-1)!.label).toBe('e24');
  });

  it('maps a server-side error source to server origin', () => {
    const { r, queue } = reporter();
    r.observe(errorEv({ source: 'server/autosave', label: 'autosave failed' }));
    expect(queue.enqueued[0]!.envelope.origin).toBe('server');
  });

  it('never throws out of observe, and never re-emits (a throwing queue is logged, not propagated)', () => {
    const queue = fakeQueue();
    queue.enqueue = () => {
      throw new Error('queue exploded');
    };
    const log = vi.fn();
    const r = createReporter({ queue, envelope, now: () => 1, log });
    expect(() => r.observe(errorEv({ label: 'x' }))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

// #137 C1: the fake array-push queue above delegates collapse away, so it can't prove the prod
// wiring. This drives the reporter through the REAL ship-queue with the same `keyOf: r.dedupKey`
// main.ts wires — a repeated error must collapse to ONE queued entry with a rising count, never N.
describe('reporter over the real ship-queue (#137 C1 — prod dedup wiring)', () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('collapses N repeats of one error to a single queued report with count === N', () => {
    dir = mkdtempSync(join(tmpdir(), 'ledrums-reporter-'));
    const queue = createShipQueue<ReportRecord>({
      path: join(dir, 'error-reports.jsonl'),
      transport: async () => {},
      keyOf: (r) => r.dedupKey, // exactly what main.ts wires — the line #137 C1 was missing
      persistDebounceMs: 600_000, // keep disk IO out of the test
    });
    clock = 1000;
    const r = createReporter({ queue, envelope, now: () => clock, breadcrumbLimit: 20 });

    const N = 300;
    const stack = 'Error: render\n    at frame (loop.js:1:1)';
    for (let i = 0; i < N; i++) r.observe(errorEv({ label: 'render', detail: stack }));

    expect(queue.size()).toBe(1); // ONE logical report, not N appended rows
    const [rec] = queue.items();
    expect(rec!.count).toBe(N);
    queue.dispose();
  });

  it('keeps distinct throw sites as separate entries (no over-collapse)', () => {
    dir = mkdtempSync(join(tmpdir(), 'ledrums-reporter-'));
    const queue = createShipQueue<ReportRecord>({
      path: join(dir, 'error-reports.jsonl'),
      transport: async () => {},
      keyOf: (r) => r.dedupKey,
      persistDebounceMs: 600_000,
    });
    clock = 1000;
    const r = createReporter({ queue, envelope, now: () => clock, breadcrumbLimit: 20 });

    for (let i = 0; i < 5; i++) r.observe(errorEv({ label: 'boom', detail: 'Error: boom\n    at f (a.js:1:1)' }));
    for (let i = 0; i < 5; i++) r.observe(errorEv({ label: 'boom', detail: 'Error: boom\n    at g (b.js:2:2)' }));

    expect(queue.size()).toBe(2);
    expect(queue.items().map((r) => r.count)).toEqual([5, 5]);
    queue.dispose();
  });
});
