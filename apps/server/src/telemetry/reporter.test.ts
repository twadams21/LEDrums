import { describe, expect, it, vi } from 'vitest';
import type { MonitorEvent } from '../ws-protocol';
import { createReporter } from './reporter';
import type { Envelope, ReportOrigin, ReportRecord } from './envelope';
import type { ShipQueue } from './ship-queue';

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
