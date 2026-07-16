import { describe, expect, it, vi } from 'vitest';
import { ingestBatch, listReports, type IngestDeps } from '../src/handlers';
import type { DiscordNotifier } from '../src/discord';
import type { IngestBatch, ReportRow, WireReport } from '../src/types';
import { fakeStore } from './fake-store';

const NOW = 1_000_000;

function wireReport(over: Partial<WireReport> = {}, env: Partial<WireReport['envelope']> = {}): WireReport {
  return {
    dedupKey: 'web boom at f (a.js:1:1)',
    envelope: {
      machine: 'rig-1',
      version: '1.0.0',
      engineMode: 'voice',
      platform: 'darwin',
      osRelease: '24.0.0',
      session: 'sess-a',
      uptimeMs: 1000,
      origin: 'web',
      ...env,
    },
    message: 'boom',
    stack: 'Error: boom\n    at f (a.js:1:1)',
    breadcrumbs: [{ time: 1, type: 'input', source: 'ws', label: 'midi' }],
    count: 1,
    firstSeenMs: 900_000,
    lastSeenMs: 950_000,
    ...over,
  };
}

const batch = (reports: WireReport[], dropped = 0): IngestBatch => ({ reports, dropped });

function deps(
  store: ReturnType<typeof fakeStore> = fakeStore(),
  notify: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): IngestDeps & { store: ReturnType<typeof fakeStore>; notify: ReturnType<typeof vi.fn> } {
  return { store, notify, now: NOW, rateWindowMs: 60_000, rateMaxNewRows: 3 };
}

describe('ingestBatch (#122)', () => {
  it('inserts a new report and pings Discord exactly once (first occurrence)', async () => {
    const d = deps();
    const res = await ingestBatch(d, batch([wireReport()]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accepted: 1, rateLimited: 0, pinged: 1, droppedUpstream: 0 });
    expect(d.store.rows).toHaveLength(1);
    expect(d.store.rows[0]!.receivedAt).toBe(NOW);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('a repeat of the same unique key bumps count and does NOT ping', async () => {
    const store = fakeStore();
    const d = deps(store);
    await ingestBatch(d, batch([wireReport({ count: 1 })]));
    d.notify.mockClear();
    await ingestBatch(d, batch([wireReport({ count: 5, lastSeenMs: 990_000 })]));
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.count).toBe(5);
    expect(store.rows[0]!.lastSeenMs).toBe(990_000);
    expect(d.notify).not.toHaveBeenCalled(); // repeat-count updates never ping
  });

  it('a new SESSION of an already-seen key upserts a row but does NOT ping', async () => {
    const store = fakeStore();
    const d = deps(store);
    await ingestBatch(d, batch([wireReport({}, { session: 'sess-a' })]));
    d.notify.mockClear();
    await ingestBatch(d, batch([wireReport({}, { session: 'sess-b' })]));
    expect(store.rows).toHaveLength(2); // distinct session ⇒ distinct row
    expect(d.notify).not.toHaveBeenCalled(); // dedup key already seen for machine+version
  });

  it('rate-limits NEW keys per machine but never drops repeats', async () => {
    const store = fakeStore();
    const d = deps(store); // rateMaxNewRows = 3
    const fresh = Array.from({ length: 5 }, (_, i) =>
      wireReport({ dedupKey: `key-${i}` }, { session: `sess-${i}` }),
    );
    const res = await ingestBatch(d, batch(fresh));
    expect(res.body).toMatchObject({ accepted: 3, rateLimited: 2 });
    expect(store.rows).toHaveLength(3);
    // a repeat of an accepted key still lands even though the machine is over its new-key budget
    d.notify.mockClear();
    const repeat = await ingestBatch(d, batch([wireReport({ dedupKey: 'key-0', count: 9 }, { session: 'sess-0' })]));
    expect(repeat.body).toMatchObject({ accepted: 1, rateLimited: 0 });
    expect(store.rows.find((r) => r.dedupKey === 'key-0')!.count).toBe(9);
  });

  it('a webhook failure never breaks ingestion (notifier swallows its own errors)', async () => {
    const notify: DiscordNotifier = async () => {
      /* the real notifier swallows; ingest must not depend on it */
    };
    const store = fakeStore();
    const res = await ingestBatch({ store, notify, now: NOW, rateWindowMs: 60_000, rateMaxNewRows: 3 }, batch([wireReport()]));
    expect(res.status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });
});

describe('listReports (#122)', () => {
  const row = (over: Partial<ReportRow>): ReportRow => ({
    machine: 'rig-1',
    version: '1.0.0',
    engineMode: 'voice',
    platform: 'darwin',
    osRelease: '24.0.0',
    session: 's',
    origin: 'web',
    dedupKey: 'k',
    message: 'm',
    stack: null,
    breadcrumbs: [],
    count: 1,
    firstSeenMs: 1,
    lastSeenMs: 1,
    receivedAt: 1,
    ...over,
  });

  it('filters by machine + version and returns newest first', async () => {
    const store = fakeStore([
      row({ machine: 'rig-1', dedupKey: 'a', lastSeenMs: 100 }),
      row({ machine: 'rig-1', dedupKey: 'b', lastSeenMs: 300 }),
      row({ machine: 'rig-2', dedupKey: 'c', lastSeenMs: 500 }),
    ]);
    const res = await listReports(store, new URL('https://w/reports?machine=rig-1'));
    expect(res.body).toMatchObject({ count: 2 });
    expect((res.body as { reports: ReportRow[] }).reports.map((r) => r.dedupKey)).toEqual(['b', 'a']);
  });

  it('honours the since filter (last_seen epoch) and clamps limit', async () => {
    const store = fakeStore([
      row({ dedupKey: 'old', lastSeenMs: 100 }),
      row({ dedupKey: 'new', lastSeenMs: 900 }),
    ]);
    const res = await listReports(store, new URL('https://w/reports?since=500&limit=99999'));
    expect((res.body as { reports: ReportRow[] }).reports.map((r) => r.dedupKey)).toEqual(['new']);
  });
});
