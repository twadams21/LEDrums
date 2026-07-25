import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShipQueue, type ShipTransport } from './ship-queue';

interface Item {
  key: string;
  count: number;
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
