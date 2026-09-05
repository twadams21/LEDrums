import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingestBatch, type IngestDeps } from '../src/handlers';
import { d1Store } from '../src/store';
import type { WireReport } from '../src/types';
import { sqliteD1 } from './sqlite-d1';
import { wire } from './report-fixture';

const NOW = 1_000_000;
const databases: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup(max = 3) {
  const local = sqliteD1();
  databases.push(local);
  const pending: Promise<unknown>[] = [];
  const notify = vi.fn().mockResolvedValue(undefined);
  const deps = {
    store: d1Store(local.db), notify, now: NOW, rateWindowMs: 60_000, rateMaxNewRows: max,
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
  } satisfies IngestDeps;
  const ingest = (...reports: WireReport[]) => ingestBatch(deps, { reports, dropped: 7 });
  return { ...local, deps, notify, pending, ingest };
}

async function finishes<T>(promise: Promise<T>): Promise<T | 'stalled'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<'stalled'>((resolve) => {
      timer = setTimeout(() => resolve('stalled'), 100);
    })]);
  } finally { clearTimeout(timer); }
}

describe('ingest atomicity — production SQL in SQLite', () => {
  it('overlapping first reports claim one notification, including across sessions', async () => {
    const s = setup();
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => s.ingest(wire('boom', `s${i % 3}`))));
    expect(responses.reduce((sum, r) => sum + (r.body as { pinged: number }).pinged, 0)).toBe(1);
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(await s.deps.store.list({ limit: 100 })).toHaveLength(3);
  });

  it('overlapping different keys cannot overrun a machine budget', async () => {
    const s = setup(3);
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => s.ingest(wire(`k${i}`))));
    expect(responses.reduce((sum, r) => sum + (r.body as { accepted: number }).accepted, 0)).toBe(3);
    expect(await s.deps.store.list({ limit: 100 })).toHaveLength(3);
    expect(s.notify).toHaveBeenCalledTimes(3);
  });

  it('exhaustion never drops repeats or new sessions, nor charges them new-error budget', async () => {
    const s = setup(2);
    await s.ingest(wire('a'));
    await s.ingest(wire('a', 's2'), wire('a', 's3'));
    expect((await s.ingest(wire('b'), wire('c'))).body).toMatchObject({ accepted: 1, rateLimited: 1 });
    expect((await s.ingest({ ...wire('a'), count: 9 }, wire('a', 's4'))).body)
      .toMatchObject({ accepted: 2, rateLimited: 0, pinged: 0 });
    // MAX(count), not SUM: overlapping shipper retries cannot inflate a session's count.
    await Promise.all([s.ingest({ ...wire('a'), count: 3 }), s.ingest({ ...wire('a'), count: 9 })]);
    const rows = await s.deps.store.list({ limit: 100 });
    expect(rows.find((r) => r.dedupKey === 'a' && r.session === 's1')).toMatchObject({ count: 9, receivedAt: NOW });
    expect(rows).toHaveLength(5);
    expect(s.notify).toHaveBeenCalledTimes(2);
  });

  it('isolates machine budgets and treats a new version as a new identity', async () => {
    const s = setup(1);
    const v2 = { ...wire(), envelope: { ...wire().envelope, version: '2' } };
    expect((await s.ingest(wire(), wire('boom', 's1', 'rig-2'), v2)).body)
      .toMatchObject({ accepted: 2, rateLimited: 1, pinged: 2 });
    s.deps.now = NOW + 60_001;
    expect((await s.ingest(v2)).body).toMatchObject({ accepted: 1, pinged: 1 });
  });

  it.each(['reject', 'throw'])('a notifier that %ss cannot break the remaining batch', async (kind) => {
    const s = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      s.notify.mockImplementation(() => {
        if (kind === 'throw') throw new Error('private-webhook-url');
        return Promise.reject(new Error('private-webhook-url'));
      });
      expect((await s.ingest(wire('a'), wire('b'))).body).toMatchObject({ accepted: 2, pinged: 2 });
      await Promise.all(s.pending);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-webhook-url');
      expect((await s.ingest(wire('a'), wire('b'))).body).toMatchObject({ accepted: 2, pinged: 0 });
    } finally { warn.mockRestore(); }
  });

  it('a later database error leaves earlier admissions committed and already scheduled', async () => {
    const s = setup();
    s.sqlite.exec(`CREATE TRIGGER reject_b BEFORE INSERT ON reports WHEN NEW.dedup_key = 'b'
      BEGIN SELECT RAISE(ABORT, 'injected database error'); END;`);
    await expect(s.ingest(wire('a'), wire('b'), wire('c'))).rejects.toThrow('injected database error');
    expect(s.pending).toHaveLength(1);
    await Promise.all(s.pending);
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect((await s.deps.store.list({ limit: 100 })).map((r) => r.dedupKey)).toEqual(['a']);
    s.sqlite.exec('DROP TRIGGER reject_b');
    expect((await s.ingest(wire('a'), wire('b'), wire('c'))).body).toMatchObject({ accepted: 3, pinged: 2 });
  });

  it('a stalled notifier does not block the response or remaining batch persistence', async () => {
    const s = setup();
    s.notify.mockImplementation(() => new Promise(() => {}));
    const result = await finishes(s.ingest(wire('a'), wire('b'), wire('c')));
    expect(result).not.toBe('stalled');
    expect(result).toMatchObject({ body: { accepted: 3, pinged: 3, droppedUpstream: 7 } });
    expect(await s.deps.store.list({ limit: 100 })).toHaveLength(3);
    expect(s.pending).toHaveLength(3);
  });
});
