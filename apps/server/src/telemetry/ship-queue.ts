import { readFileSync } from 'node:fs';
import { writeFileAtomic, writeFileAtomicSync } from '../atomic-file';

/**
 * A durable, capped, batched outbox — the reusable ship machinery behind the error Reporter (#122)
 * and, by design, the backups queue (#123): both need the same discipline (atomic disk persistence,
 * hard caps with drop-oldest + a shipped dropped-counter, a periodic batch flush, exponential backoff
 * on failure, and boot-recovery), differing only in payload type and keying. It is therefore GENERIC
 * over the payload `T` and knows nothing about reports.
 *
 * Keying: pass `keyOf` to make `enqueue` an upsert-by-key (later items REPLACE the queued copy for
 * that key, keeping its position) — this is how a render-loop error firing 120×/s collapses to ONE
 * queued entry whose count field the caller keeps bumping in place, instead of flooding the queue.
 * Omit `keyOf` for an append-only queue (the backups case).
 *
 * Durability: the queue is mirrored to a JSONL file. Mutations trigger a coalesced async atomic
 * write (disk IO never blocks a caller); {@link ShipQueue.persistSync} forces a synchronous atomic
 * write for the crash/shutdown path, so a report describing a crash reaches disk before the process
 * dies. The factory reloads the file on construction (retry-on-boot).
 *
 * Isolation: a transport that throws NEVER propagates — the batch stays queued and backs off. The
 * queue reports its own failures only through the injected `log` (never by emitting an error event),
 * so a shipping failure can never recurse into the very stream it ships.
 */
export type ShipTransport<T> = (items: T[], meta: { dropped: number }) => Promise<void>;

export interface ShipQueueOptions<T> {
  /** JSONL file the queue is mirrored to (one JSON item per line). */
  path: string;
  /** Ship a batch. Rejects to signal failure (the batch is retained + backed off). */
  transport: ShipTransport<T>;
  /** Upsert key per item. Provided → dedup/replace by key; omitted → append-only. */
  keyOf?: (item: T) => string;
  /** Max retained items before drop-oldest (default 200). */
  maxItems?: number;
  /** Approx max retained bytes (serialized) before drop-oldest (default 2,000,000). */
  maxBytes?: number;
  /** Base flush cadence when non-empty (default 30,000ms). */
  flushIntervalMs?: number;
  /** Backoff ceiling (default 30 min). */
  maxBackoffMs?: number;
  /** Coalesce window for async disk writes (default 1,000ms). */
  persistDebounceMs?: number;
  /** Local-only logger for the queue's own failures (default console.error). */
  log?: (message: string) => void;
}

export interface ShipQueue<T> {
  /** Add (or upsert-by-key) an item; enforces caps and schedules a flush. */
  enqueue(item: T): void;
  /** Ship now, bypassing the cadence; resolves once the attempt settles (never rejects). */
  flush(): Promise<void>;
  /** Synchronous atomic disk write of the current queue (crash/shutdown path). */
  persistSync(): void;
  /** Retained item count. */
  size(): number;
  /** Reports dropped-at-cap since the last successful ship (ships as batch meta). */
  dropped(): number;
  /** Snapshot of retained items (introspection/tests). */
  items(): T[];
  /** Cancel timers (does not flush). */
  dispose(): void;
}

const DEFAULTS = {
  maxItems: 200,
  maxBytes: 2_000_000,
  flushIntervalMs: 30_000,
  maxBackoffMs: 30 * 60_000,
  persistDebounceMs: 1_000,
};

export function createShipQueue<T>(opts: ShipQueueOptions<T>): ShipQueue<T> {
  const maxItems = opts.maxItems ?? DEFAULTS.maxItems;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const flushIntervalMs = opts.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
  const maxBackoffMs = opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const persistDebounceMs = opts.persistDebounceMs ?? DEFAULTS.persistDebounceMs;
  const log = opts.log ?? ((m: string): void => console.error(m));

  // Insertion-ordered store (Map preserves order; re-setting an existing key keeps its position).
  const store = new Map<string, T>();
  const lengths = new Map<string, number>(); // cached serialized byte length per key
  let bytes = 0;
  let seq = 0;
  let droppedCount = 0;

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let shipInFlight: Promise<void> | null = null;
  let failures = 0;
  let persistChain: Promise<void> = Promise.resolve();

  function keyFor(item: T): string {
    return opts.keyOf ? opts.keyOf(item) : String(seq++);
  }

  function serialize(): string {
    let out = '';
    for (const item of store.values()) out += `${JSON.stringify(item)}\n`;
    return out;
  }

  function schedulePersist(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const data = serialize();
      persistChain = persistChain.then(() =>
        writeFileAtomic(opts.path, data).catch((err: unknown) => {
          log(`[ship-queue] persist failed: ${err instanceof Error ? err.message : String(err)}`);
        }),
      );
    }, persistDebounceMs);
    (persistTimer as { unref?: () => void }).unref?.();
  }

  function enforceCaps(): void {
    while (store.size > maxItems || bytes > maxBytes) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      bytes -= lengths.get(oldest) ?? 0;
      store.delete(oldest);
      lengths.delete(oldest);
      droppedCount++;
    }
  }

  function scheduleFlush(delay: number): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void tick();
    }, delay);
    (flushTimer as { unref?: () => void }).unref?.();
  }

  async function tick(): Promise<void> {
    await doShip();
    // Reschedule only while items remain: idle → no wakeups; failed → backoff; ok-but-refilled → base.
    if (store.size > 0) {
      const delay = failures > 0 ? Math.min(flushIntervalMs * 2 ** failures, maxBackoffMs) : flushIntervalMs;
      scheduleFlush(delay);
    }
  }

  function doShip(): Promise<void> {
    if (shipInFlight) return shipInFlight;
    if (store.size === 0) return Promise.resolve();
    const keys = [...store.keys()];
    const batch = keys.map((k) => store.get(k)!);
    const droppedSnapshot = droppedCount;
    // Wrap in an async IIFE so a SYNCHRONOUS throw from the transport is normalized to a rejection
    // and handled by the same failure path — the queue must never let a transport fault escape.
    shipInFlight = (async () => {
      try {
        await opts.transport(batch, { dropped: droppedSnapshot });
        // Success: remove exactly what shipped (items enqueued during the await are retained).
        for (const k of keys) {
          bytes -= lengths.get(k) ?? 0;
          store.delete(k);
          lengths.delete(k);
        }
        droppedCount -= droppedSnapshot;
        failures = 0;
        schedulePersist();
      } catch (err) {
        failures++;
        log(`[ship-queue] ship failed (attempt ${failures}): ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        shipInFlight = null;
      }
    })();
    return shipInFlight;
  }

  // Boot-recovery: reload the JSONL so a queue survives a restart (retry-on-boot).
  try {
    const raw = readFileSync(opts.path, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const item = JSON.parse(line) as T;
      const k = keyFor(item);
      const len = Buffer.byteLength(line) + 1;
      if (!store.has(k)) bytes += len;
      else bytes += len - (lengths.get(k) ?? 0);
      store.set(k, item);
      lengths.set(k, len);
    }
    enforceCaps();
    if (store.size > 0) scheduleFlush(flushIntervalMs);
  } catch {
    /* no prior queue (ENOENT) or unreadable — start empty */
  }

  return {
    enqueue(item: T): void {
      const k = keyFor(item);
      const len = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (store.has(k)) bytes += len - (lengths.get(k) ?? 0);
      else bytes += len;
      store.set(k, item);
      lengths.set(k, len);
      enforceCaps();
      schedulePersist();
      scheduleFlush(flushIntervalMs);
    },
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await doShip();
      if (store.size > 0) {
        const delay = failures > 0 ? Math.min(flushIntervalMs * 2 ** failures, maxBackoffMs) : flushIntervalMs;
        scheduleFlush(delay);
      }
    },
    persistSync(): void {
      try {
        writeFileAtomicSync(opts.path, serialize());
      } catch (err) {
        log(`[ship-queue] persistSync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    size: () => store.size,
    dropped: () => droppedCount,
    items: () => [...store.values()],
    dispose(): void {
      if (flushTimer) clearTimeout(flushTimer);
      if (persistTimer) clearTimeout(persistTimer);
      flushTimer = null;
      persistTimer = null;
    },
  };
}
