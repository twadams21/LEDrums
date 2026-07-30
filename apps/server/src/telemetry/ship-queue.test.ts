import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShipQueue, type ShipQueueState, type ShipTransport } from './ship-queue';
import { ShipHttpError } from './transport';

interface Item {
  key: string;
  count: number;
  /** Ballast, so a test can build items of a known serialized size for the byte-budget cases (S4). */
  pad?: string;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledrums-shipq-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const path = (): string => join(dir, 'queue.jsonl');

describe('createShipQueue (#122 generic outbox)', () => {
  it('ships the queued batch on the flush cadence, then empties', async () => {
    vi.useFakeTimers();
    const shipped: Item[][] = [];
    const transport: ShipTransport<Item> = async (items) => {
      shipped.push(items);
    };
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, flushIntervalMs: 30_000, persistDebounceMs: 600_000 });
    q.enqueue({ key: 'a', count: 1 });
    q.enqueue({ key: 'b', count: 1 });
    expect(shipped).toHaveLength(0); // nothing ships before the cadence fires
    await vi.advanceTimersByTimeAsync(30_000);
    expect(shipped).toEqual([[{ key: 'a', count: 1 }, { key: 'b', count: 1 }]]);
    expect(q.size()).toBe(0);
    q.dispose();
  });

  it('upserts by key — a storm of one key collapses to a single queued entry (latest wins)', async () => {
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, persistDebounceMs: 60_000 });
    for (let n = 1; n <= 120; n++) q.enqueue({ key: 'render-loop', count: n });
    expect(q.size()).toBe(1);
    await q.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toEqual([{ key: 'render-loop', count: 120 }]);
    q.dispose();
  });

  it('drops oldest at the item cap and ships the dropped count as batch meta', async () => {
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, maxItems: 3, persistDebounceMs: 60_000 }); // append-only (no keyOf)
    for (let n = 1; n <= 5; n++) q.enqueue({ key: `k${n}`, count: n });
    expect(q.size()).toBe(3);
    expect(q.dropped()).toBe(2);
    await q.flush();
    expect(transport.mock.calls[0]![1]).toEqual({ dropped: 2 });
    // the three NEWEST survived
    expect(transport.mock.calls[0]![0].map((i) => i.key)).toEqual(['k3', 'k4', 'k5']);
    expect(q.dropped()).toBe(0); // reset once shipped
    q.dispose();
  });

  it('retains the batch and backs off when the transport fails, then ships on retry', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<ShipTransport<Item>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, flushIntervalMs: 30_000, persistDebounceMs: 600_000 });
    q.enqueue({ key: 'a', count: 1 });
    await vi.advanceTimersByTimeAsync(30_000); // first attempt rejects
    expect(transport).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(1); // retained
    // backoff = 30s * 2^1 = 60s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0);
    q.dispose();
  });

  it('a transport that throws never propagates out of a flush', async () => {
    const transport: ShipTransport<Item> = () => {
      throw new Error('sync throw');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, persistDebounceMs: 60_000 });
    q.enqueue({ key: 'a', count: 1 });
    await expect(q.flush()).resolves.toBeUndefined();
    expect(q.size()).toBe(1);
    q.dispose();
  });

  it('survives a restart — persistSync then a fresh queue reloads the items (retry-on-boot)', async () => {
    const p = path();
    const q1 = createShipQueue<Item>({ path: p, transport: async () => {}, keyOf: (i) => i.key, persistDebounceMs: 60_000 });
    q1.enqueue({ key: 'a', count: 3 });
    q1.enqueue({ key: 'b', count: 1 });
    q1.persistSync();
    q1.dispose();
    // the JSONL is on disk
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(2);

    const shipped: Item[][] = [];
    const q2 = createShipQueue<Item>({
      path: p,
      transport: async (items) => {
        shipped.push(items);
      },
      keyOf: (i) => i.key,
      persistDebounceMs: 60_000,
    });
    expect(q2.size()).toBe(2);
    await q2.flush();
    expect(shipped[0]).toEqual([{ key: 'a', count: 3 }, { key: 'b', count: 1 }]);
    q2.dispose();
  });
});

describe('createShipQueue outcome policy (#137 INIT-11 S3)', () => {
  const deadPath = (): string => `${path()}.deadletter.jsonl`;

  /** A transport that rejects with the queued statuses in order, then resolves forever. */
  const statusTransport = (
    ...statuses: number[]
  ): ReturnType<typeof vi.fn<ShipTransport<Item>>> => {
    const t = vi.fn<ShipTransport<Item>>();
    for (const s of statuses) t.mockRejectedValueOnce(new ShipHttpError(s));
    t.mockResolvedValue(undefined);
    return t;
  };

  const silenceLog = (): void => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  };

  it('a 400 dead-letters the batch and keeps draining', async () => {
    silenceLog();
    const onDeadLetter = vi.fn();
    const transport = statusTransport(400);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, persistDebounceMs: 60_000, onDeadLetter });
    q.enqueue({ key: 'a', count: 1 });
    q.enqueue({ key: 'b', count: 1 });
    await q.flush();

    // The poison batch is GONE from the queue — it can never block the items behind it.
    expect(q.size()).toBe(0);
    expect(q.state()).toBe<ShipQueueState>('ok');
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter).toHaveBeenCalledWith(2, 400);
    // ...and parked on disk, one JSON item per line.
    expect(readFileSync(deadPath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l))).toEqual([
      { key: 'a', count: 1 },
      { key: 'b', count: 1 },
    ]);

    // The queue keeps working: the next batch ships normally against the now-succeeding transport.
    q.enqueue({ key: 'c', count: 1 });
    await q.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]![0]).toEqual([{ key: 'c', count: 1 }]);
    expect(q.size()).toBe(0);
    q.dispose();
  });

  it('a 401 blocks and stops rescheduling', async () => {
    vi.useFakeTimers();
    silenceLog();
    const onStateChange = vi.fn();
    const transport = statusTransport(401);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, flushIntervalMs: 30_000, persistDebounceMs: 600_000, onStateChange });
    q.enqueue({ key: 'a', count: 1 });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(q.state()).toBe<ShipQueueState>('blocked');
    expect(q.size()).toBe(1); // retained, not lost
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith('blocked', 'ingest rejected credentials (401)');

    // Thirty minutes of wall clock — the old code would have re-POSTed a doomed request all the way
    // up the backoff curve and then once every 30 minutes forever.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(transport).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it('a blocked queue does not ship on new enqueues', async () => {
    vi.useFakeTimers();
    silenceLog();
    const p = path();
    const transport = statusTransport(401);
    const q = createShipQueue<Item>({ path: p, transport, keyOf: (i) => i.key, flushIntervalMs: 30_000, persistDebounceMs: 600_000, onStateChange: vi.fn() });
    q.enqueue({ key: 'a', count: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);

    // A live error stream keeps arriving while blocked.
    q.enqueue({ key: 'b', count: 1 });
    q.enqueue({ key: 'c', count: 1 });
    q.enqueue({ key: 'd', count: 1 });

    // Exactly one timer is pending — the 600s persist debounce, armed by the first enqueue. NO flush
    // timer. This is the assertion that pins enqueue's own guard specifically: doShip's guard would
    // keep the transport count at 1 either way, so a call-count assertion alone cannot tell the two
    // guards apart, and enqueue would go on arming a doomed wakeup per upsert unnoticed.
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(5 * 30_000);

    expect(transport).toHaveBeenCalledTimes(1); // UNCHANGED
    expect(q.size()).toBe(4); // retention and caps still work while blocked
    q.persistSync(); // and so does durability — all four survive a crash while blocked
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(4);
    q.dispose();
  });

  it('flush() clears blocked and retries once', async () => {
    silenceLog();
    const onStateChange = vi.fn();
    const transport = statusTransport(401);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, persistDebounceMs: 60_000, onStateChange });
    q.enqueue({ key: 'a', count: 1 });
    await q.flush();
    expect(q.state()).toBe<ShipQueueState>('blocked');

    // Operator re-bakes the token and flushes — no restart needed.
    await q.flush();
    expect(q.size()).toBe(0);
    expect(q.state()).toBe<ShipQueueState>('ok');
    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(onStateChange.mock.calls[1]).toEqual(['ok', 'shipped 1 item(s)']);
    q.dispose();
  });

  it('onStateChange is transition-only — a long outage emits once, not once per attempt', async () => {
    silenceLog();
    const onStateChange = vi.fn();
    const transport = statusTransport(503, 503, 503);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, persistDebounceMs: 60_000, onStateChange });
    q.enqueue({ key: 'a', count: 1 });
    await q.flush();
    await q.flush();
    await q.flush();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange.mock.calls[0]![0]).toBe('retrying');
    q.dispose();
  });

  it('a 503 retains and backs off exactly as an unclassified failure does', async () => {
    // The parity anchor: the twin of the pre-existing 'retains the batch and backs off' case, with a
    // typed retryable rejection instead of a bare Error. Identical call counts, identical 60s timing.
    vi.useFakeTimers();
    silenceLog();
    const transport = statusTransport(503);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, flushIntervalMs: 30_000, persistDebounceMs: 600_000 });
    q.enqueue({ key: 'a', count: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(1);
    expect(q.state()).toBe<ShipQueueState>('retrying');
    await vi.advanceTimersByTimeAsync(60_000); // backoff = 30s * 2^1
    expect(transport).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0);
    expect(q.state()).toBe<ShipQueueState>('ok');
    q.dispose();
  });

  it('the dead-letter cap survives a restart', async () => {
    silenceLog();
    const log = vi.fn();
    const p = path();
    // A prior process already filled the file past the cap. An in-memory-only tally would reset here
    // and happily keep appending, so the file would grow without bound across restarts.
    writeFileSync(`${p}.deadletter.jsonl`, 'x'.repeat(4_100_000));
    const q = createShipQueue<Item>({ path: p, transport: statusTransport(400), keyOf: (i) => i.key, persistDebounceMs: 60_000, log });
    q.enqueue({ key: 'a', count: 1 });
    await q.flush();

    expect(readFileSync(`${p}.deadletter.jsonl`, 'utf8')).toHaveLength(4_100_000); // NOT appended to
    expect(log.mock.calls.flat().join('\n')).toContain('dead-letter file at cap');
    expect(q.size()).toBe(0); // the batch is still dropped — a full file must not re-wedge the queue
    q.dispose();
  });

  it('a successful ship writes no dead-letter file at all', async () => {
    const q = createShipQueue<Item>({ path: path(), transport: async () => {}, keyOf: (i) => i.key, persistDebounceMs: 60_000 });
    q.enqueue({ key: 'a', count: 1 });
    await q.flush();
    expect(existsSync(deadPath())).toBe(false);
    q.dispose();
  });
});

describe('createShipQueue byte-budgeted batches (#137 INIT-11 S4)', () => {
  /** ~200 bytes serialized, so `maxBatchBytes: 500` fits exactly two per batch. */
  const fat = (key: string): Item => ({ key, count: 1, pad: 'x'.repeat(160) });

  it('cuts a batch at the byte budget, in insertion order', async () => {
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, maxBatchBytes: 500, persistDebounceMs: 60_000 });
    for (let n = 1; n <= 10; n++) q.enqueue(fat(`k${n}`));
    await q.flush();

    const first = transport.mock.calls[0]![0];
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(10); // it was genuinely CUT, not shipped whole
    expect(first.map((i) => i.key)).toEqual(['k1', 'k2']); // the oldest, in insertion order
    expect(q.size()).toBe(10 - first.length); // the remainder is retained, not lost
    q.dispose();
  });

  it('always ships at least one item, even one bigger than the whole budget', async () => {
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, maxBatchBytes: 50, persistDebounceMs: 60_000 });
    q.enqueue(fat('huge'));
    await q.flush();
    // The Worker's own cap is then the authority, and S3 dead-letters it — an item can never wedge
    // the queue by being individually un-shippable.
    expect(transport.mock.calls[0]![0].map((i) => i.key)).toEqual(['huge']);
    expect(q.size()).toBe(0);
    q.dispose();
  });

  it('drains the remainder on the short delay, not the full flush interval', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, maxBatchBytes: 500, flushIntervalMs: 30_000, persistDebounceMs: 600_000 });
    for (let n = 1; n <= 6; n++) q.enqueue(fat(`k${n}`));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);

    // A 100-item backlog must drain in ~100s, not ~50 minutes.
    await vi.advanceTimersByTimeAsync(999);
    expect(transport).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).toHaveBeenCalledTimes(2); // at exactly +1_000ms
    q.dispose();
  });

  it('a blocked queue does not drain — the S3 guard outranks the drain delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = vi
      .fn<ShipTransport<Item>>()
      .mockResolvedValueOnce(undefined) // partial ship succeeds, leaving a remainder
      .mockRejectedValueOnce(new ShipHttpError(401)) // the drain attempt is rejected
      .mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, keyOf: (i) => i.key, maxBatchBytes: 500, flushIntervalMs: 30_000, persistDebounceMs: 600_000 });
    for (let n = 1; n <= 6; n++) q.enqueue(fat(`k${n}`));
    await vi.advanceTimersByTimeAsync(30_000); // call 1: partial ship
    await vi.advanceTimersByTimeAsync(1_000); // call 2: drain, 401 → blocked
    expect(transport).toHaveBeenCalledTimes(2);
    expect(q.state()).toBe<ShipQueueState>('blocked');

    // No third call: DRAIN_DELAY_MS must not sneak past the blocked guard.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport).toHaveBeenCalledTimes(2);
    q.dispose();
  });

  it('the dropped counter still ships with the FIRST batch and resets only on its success', async () => {
    const transport = vi.fn<ShipTransport<Item>>().mockResolvedValue(undefined);
    const q = createShipQueue<Item>({ path: path(), transport, maxItems: 6, maxBatchBytes: 500, persistDebounceMs: 60_000 }); // append-only
    for (let n = 1; n <= 8; n++) q.enqueue(fat(`k${n}`));
    expect(q.dropped()).toBe(2);
    await q.flush();
    expect(transport.mock.calls[0]![1]).toEqual({ dropped: 2 }); // rides the first (cut) batch
    expect(q.dropped()).toBe(0); // and resets on ITS success, not the whole drain's
    expect(q.size()).toBeGreaterThan(0); // a remainder is genuinely still queued
    q.dispose();
  });
});
