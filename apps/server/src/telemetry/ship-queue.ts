import { readFileSync, promises as fsp } from 'node:fs';
import { writeFileAtomic, writeFileAtomicSync } from '../atomic-file';
import { ShipHttpError } from './transport';

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
 * Outcome policy: a transport that throws NEVER propagates, but not every failure means the same
 * thing. The rejection is classified into three outcomes (see {@link ShipHttpError}):
 *   - TRANSIENT (5xx / 408 / 429, or any unclassified rejection like DNS or offline) → retain the
 *     batch and back off. This is the historical behaviour and remains untouched.
 *   - CREDENTIALS (401 / 403) → enter `blocked`: retain the batch and genuinely STOP shipping. A
 *     rotated token used to wedge the queue at the 30-minute backoff ceiling, re-POSTing a doomed
 *     request forever. `flush()` is the operator escape hatch — it re-arms and retries once.
 *   - POISON (any other permanent status: 400 / 404 / 413 / 422 / …) → append the batch to
 *     `<path>.deadletter.jsonl` and DROP it, so one malformed item can never block the items behind
 *     it. Dead-letters are forensic, not a second queue: the file is capped at
 *     `MAX_DEADLETTER_BYTES` and nothing ever re-ingests it.
 *
 * Isolation (unchanged, and load-bearing): the queue still NEVER emits onto the Monitor bus. It
 * reports its own health only through injected plain functions — `log`, `onStateChange` and
 * `onDeadLetter`, all exactly as inert as each other — and it is the composition root, not the queue,
 * that turns those into Monitor events. A shipping failure therefore cannot recurse into the very
 * stream it ships.
 */
export type ShipTransport<T> = (items: T[], meta: { dropped: number }) => Promise<void>;

/** Health of the shipping path. `blocked` is the only state that stops the queue shipping at all. */
export type ShipQueueState = 'ok' | 'retrying' | 'blocked';

/** A dead-letter file is a debugging aid, not an unbounded second queue. */
const MAX_DEADLETTER_BYTES = 4_000_000;

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
  /**
   * Max serialized bytes per SHIPPED batch (default 900,000). Distinct from `maxBytes`, which caps
   * what is RETAINED: retention can legitimately exceed what one HTTP body may carry, so a batch is
   * cut to an insertion-ordered prefix that fits. Keep this under the ingest Worker's own body cap.
   */
  maxBatchBytes?: number;
  /** Base flush cadence when non-empty (default 30,000ms). */
  flushIntervalMs?: number;
  /** Backoff ceiling (default 30 min). */
  maxBackoffMs?: number;
  /** Coalesce window for async disk writes (default 1,000ms). */
  persistDebounceMs?: number;
  /** Local-only logger for the queue's own failures (default console.error). */
  log?: (message: string) => void;
  /**
   * Health TRANSITIONS only — fires when the state actually changes, never per attempt, so a long
   * outage produces one event rather than one every backoff tick.
   */
  onStateChange?: (state: ShipQueueState, detail: string) => void;
  /**
   * Fires on EVERY dead-lettered batch. Deliberately not folded into `onStateChange`: a dead-letter
   * is an event, not a state, and a transition-only channel would swallow the second one.
   */
  onDeadLetter?: (count: number, status: number) => void;
}

export interface ShipQueue<T> {
  /** Add (or upsert-by-key) an item; enforces caps and schedules a flush. */
  enqueue(item: T): void;
  /**
   * Ship now, bypassing the cadence AND the blocked guard; resolves once the attempt settles (never
   * rejects). This is the operator escape hatch out of `blocked` — a re-baked token recovers without
   * a process restart.
   */
  flush(): Promise<void>;
  /** Current health of the shipping path. */
  state(): ShipQueueState;
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
  maxBatchBytes: 900_000,
  flushIntervalMs: 30_000,
  maxBackoffMs: 30 * 60_000,
  persistDebounceMs: 1_000,
};

/**
 * A ship can now leave items behind, so a partial success reschedules on this instead of the full
 * flush interval — a 100-item backlog drains in ~100s rather than ~50 minutes. Failure paths keep
 * their backoff, and the blocked guard outranks this like every other reschedule site.
 */
const DRAIN_DELAY_MS = 1_000;

export function createShipQueue<T>(opts: ShipQueueOptions<T>): ShipQueue<T> {
  const maxItems = opts.maxItems ?? DEFAULTS.maxItems;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxBatchBytes = opts.maxBatchBytes ?? DEFAULTS.maxBatchBytes;
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
  let blocked = false;
  let lastState: ShipQueueState = 'ok';
  // Dead-letter byte tally. Seeded from a stat on the FIRST append rather than kept purely in memory:
  // an in-memory-only tally resets every boot, which would let the file grow without bound across
  // restarts. The stat/append pair races only against another process writing the same file, which
  // the single-server model does not do — that slack is accepted, not defended with a lock.
  let deadLetterBytes: number | null = null;
  const deadLetterPath = `${opts.path}.deadletter.jsonl`;

  /** Emit a health transition. Non-transitions are swallowed here, so no call site has to check. */
  function setState(next: ShipQueueState, detail: string): void {
    if (next === lastState) return;
    lastState = next;
    opts.onStateChange?.(next, detail);
  }

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

  /**
   * Delay before the next attempt, given items remain. Failed → the existing backoff curve, untouched.
   * Otherwise the last attempt settled without failing and still left a remainder — which since the
   * byte cut is the normal case, not an anomaly — so drain promptly rather than idling a full
   * interval per batch. (A ship that merely got refilled during its own await lands here too; a fast
   * drain is the wanted behaviour in that case as well.)
   */
  function rescheduleDelay(): number {
    if (failures > 0) return Math.min(flushIntervalMs * 2 ** failures, maxBackoffMs);
    return DRAIN_DELAY_MS;
  }

  async function tick(): Promise<void> {
    await doShip();
    // Reschedule only while items remain: idle → no wakeups; failed → backoff; partial → drain fast.
    // A blocked queue arms no timer at all — that is what makes `blocked` different from a long backoff.
    if (store.size > 0 && !blocked) scheduleFlush(rescheduleDelay());
  }

  /**
   * The insertion-ordered PREFIX of the store that fits in one body, by the cached per-item lengths.
   * The report queue retains up to 2MB against the Worker's 1MB body cap, so shipping the whole store
   * was a straightforwardly reachable permanent 413; cutting here makes that unreachable and shrinks
   * a poison batch's blast radius at the same time.
   *
   * At least one item always ships: an item larger than the whole budget goes alone, and the Worker's
   * own cap becomes the authority — S3 then dead-letters it rather than wedging on it.
   */
  function batchKeys(): string[] {
    const picked: string[] = [];
    let total = 0;
    for (const k of store.keys()) {
      const len = lengths.get(k) ?? 0;
      if (picked.length > 0 && total + len > maxBatchBytes) break;
      picked.push(k);
      total += len;
    }
    return picked;
  }

  /** Drop `keys` from the store. Shared by the success and dead-letter paths. */
  function removeShipped(keys: string[]): void {
    for (const k of keys) {
      bytes -= lengths.get(k) ?? 0;
      store.delete(k);
      lengths.delete(k);
    }
  }

  /**
   * Append a poison batch to `<path>.deadletter.jsonl`. Chained onto `persistChain` with async
   * `appendFile`, so it serializes behind the queue's own writes and never blocks a caller.
   */
  async function deadLetter(batch: T[], status: number): Promise<void> {
    const chunk = batch.map((item) => `${JSON.stringify(item)}\n`).join('');
    persistChain = persistChain.then(async () => {
      try {
        if (deadLetterBytes === null) {
          deadLetterBytes = await fsp.stat(deadLetterPath).then(
            (s) => s.size,
            () => 0, // ENOENT — no prior dead-letter file
          );
        }
        if (deadLetterBytes >= MAX_DEADLETTER_BYTES) {
          log(`[ship-queue] dead-letter file at cap (${deadLetterBytes} bytes) — dropping ${batch.length} item(s)`);
          return;
        }
        await fsp.appendFile(deadLetterPath, chunk);
        deadLetterBytes += Buffer.byteLength(chunk);
      } catch (err) {
        log(`[ship-queue] dead-letter append failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    await persistChain;
  }

  function doShip(force = false): Promise<void> {
    if (shipInFlight) return shipInFlight;
    // The authoritative blocked guard — and NOT just a backstop: `blocked` is only set in this
    // function's catch, AFTER the transport await, so an `enqueue` racing the in-flight 401 sees
    // blocked === false and arms a flush timer that survives the transition. When that timer
    // fires, `tick` calls doShip() unconditionally and THIS line is what prevents one more
    // rejected POST. It is also the one check that does not depend on every future scheduling
    // site remembering to look at `blocked`.
    if (blocked && !force) return Promise.resolve();
    if (store.size === 0) return Promise.resolve();
    const keys = batchKeys();
    const batch = keys.map((k) => store.get(k)!);
    const droppedSnapshot = droppedCount;
    // Wrap in an async IIFE so a SYNCHRONOUS throw from the transport is normalized to a rejection
    // and handled by the same failure path — the queue must never let a transport fault escape.
    shipInFlight = (async () => {
      try {
        await opts.transport(batch, { dropped: droppedSnapshot });
        // Success: remove exactly what shipped (items enqueued during the await are retained).
        removeShipped(keys);
        droppedCount -= droppedSnapshot;
        failures = 0;
        blocked = false;
        schedulePersist();
        setState('ok', `shipped ${batch.length} item(s)`);
      } catch (err) {
        const status = err instanceof ShipHttpError ? err.status : null;
        if (status === 401 || status === 403) {
          // CREDENTIALS: retrying cannot help. Retain the batch, stop shipping, wait for an operator.
          // `failures` is deliberately NOT incremented — there is no backoff to escalate.
          blocked = true;
          log(`[ship-queue] ship blocked: ingest rejected credentials (${status})`);
          setState('blocked', `ingest rejected credentials (${status})`);
        } else if (status !== null && !(err as ShipHttpError).retryable) {
          // POISON: this batch will be rejected identically forever. Park it and keep draining, so
          // one bad item cannot hold the whole queue hostage.
          removeShipped(keys);
          failures = 0;
          log(`[ship-queue] dead-lettered ${batch.length} item(s) after ${status} → ${deadLetterPath}`);
          await deadLetter(batch, status);
          opts.onDeadLetter?.(batch.length, status);
          schedulePersist();
          setState('ok', `dead-lettered ${batch.length} item(s) after ${status}`);
        } else {
          // TRANSIENT (or unclassified): exactly the historical path — retain, count, back off.
          failures++;
          log(`[ship-queue] ship failed (attempt ${failures}): ${err instanceof Error ? err.message : String(err)}`);
          setState('retrying', `ship failed (attempt ${failures})`);
        }
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
      // Retention and durability are unaffected by `blocked` — only the wakeup is. Without this
      // guard a live error stream would re-arm the timer on every single upsert.
      if (!blocked) scheduleFlush(flushIntervalMs);
    },
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // The operator escape hatch: re-arm a blocked queue and give the credentials one more go.
      blocked = false;
      await doShip(true);
      if (store.size > 0 && !blocked) scheduleFlush(rescheduleDelay());
    },
    persistSync(): void {
      try {
        writeFileAtomicSync(opts.path, serialize());
      } catch (err) {
        log(`[ship-queue] persistSync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    size: () => store.size,
    state: () => (blocked ? 'blocked' : failures > 0 ? 'retrying' : 'ok'),
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
