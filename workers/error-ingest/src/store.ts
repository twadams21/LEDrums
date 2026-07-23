import type { D1Database } from './cf';
import type { ReportRow, WireBreadcrumb } from './types';

/**
 * The persistence seam the handlers depend on — abstracted so handler logic is unit-testable with a
 * fake in-memory store (no live Cloudflare). The real {@link d1Store} maps it onto D1 SQL and is the
 * only part exercised by manual integration (per the spec's testing decisions).
 */
export interface ReportStore {
  /** Rows CREATED for `machine` at/after `sinceMs` — the per-machine rate-limit signal (upserts of
   * an existing row do NOT count, so a same-key storm is deduped, not rate-limited). */
  countCreatedSince(machine: string, sinceMs: number): Promise<number>;
  /** Whether ANY row already exists for (machine, version, dedupKey) — the webhook newness gate. */
  dedupKeySeen(machine: string, version: string, dedupKey: string): Promise<boolean>;
  /** Insert a new row, or bump count/last-seen on the existing (machine,version,session,dedupKey).
   * Webhook newness is decided by {@link ReportStore.dedupKeySeen} BEFORE the upsert, not from here. */
  upsert(row: ReportRow): Promise<void>;
  /** Read rows filtered by machine/version/since (newest first), capped at `limit`. */
  list(filter: { machine?: string; version?: string; since?: number; limit: number }): Promise<ReportRow[]>;
}

interface D1RowShape {
  id: number;
  machine: string;
  version: string;
  engine_mode: string;
  platform: string;
  os_release: string;
  session: string;
  origin: string;
  dedup_key: string;
  message: string;
  stack: string | null;
  breadcrumbs: string;
  count: number;
  first_seen: number;
  last_seen: number;
  received_at: number;
}

function toRow(r: D1RowShape): ReportRow {
  let breadcrumbs: WireBreadcrumb[] = [];
  try {
    breadcrumbs = JSON.parse(r.breadcrumbs) as WireBreadcrumb[];
  } catch {
    breadcrumbs = [];
  }
  return {
    id: r.id,
    machine: r.machine,
    version: r.version,
    engineMode: r.engine_mode,
    platform: r.platform,
    osRelease: r.os_release,
    session: r.session,
    origin: r.origin,
    dedupKey: r.dedup_key,
    message: r.message,
    stack: r.stack,
    breadcrumbs,
    count: r.count,
    firstSeenMs: r.first_seen,
    lastSeenMs: r.last_seen,
    receivedAt: r.received_at,
  };
}

/** D1-backed {@link ReportStore}. The unique key is (machine, version, session, dedup_key); a repeat
 * upserts count/last_seen without changing received_at, so rate-limiting counts only fresh rows. */
export function d1Store(db: D1Database): ReportStore {
  return {
    async countCreatedSince(machine, sinceMs) {
      const row = await db
        .prepare('SELECT COUNT(*) AS c FROM reports WHERE machine = ? AND received_at >= ?')
        .bind(machine, sinceMs)
        .first<{ c: number }>();
      return row?.c ?? 0;
    },
    async dedupKeySeen(machine, version, dedupKey) {
      const row = await db
        .prepare('SELECT 1 AS x FROM reports WHERE machine = ? AND version = ? AND dedup_key = ? LIMIT 1')
        .bind(machine, version, dedupKey)
        .first<{ x: number }>();
      return row != null;
    },
    async upsert(r) {
      await db
        .prepare(
          `INSERT INTO reports
             (machine, version, engine_mode, platform, os_release, session, origin, dedup_key,
              message, stack, breadcrumbs, count, first_seen, last_seen, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(machine, version, session, dedup_key) DO UPDATE SET
             count = MAX(count, excluded.count),
             last_seen = excluded.last_seen`,
        )
        .bind(
          r.machine,
          r.version,
          r.engineMode,
          r.platform,
          r.osRelease,
          r.session,
          r.origin,
          r.dedupKey,
          r.message,
          r.stack,
          JSON.stringify(r.breadcrumbs),
          r.count,
          r.firstSeenMs,
          r.lastSeenMs,
          r.receivedAt,
        )
        .run();
    },
    async list(filter) {
      const clauses: string[] = [];
      const binds: unknown[] = [];
      if (filter.machine) {
        clauses.push('machine = ?');
        binds.push(filter.machine);
      }
      if (filter.version) {
        clauses.push('version = ?');
        binds.push(filter.version);
      }
      if (filter.since != null) {
        clauses.push('last_seen >= ?');
        binds.push(filter.since);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      binds.push(filter.limit);
      const res = await db
        .prepare(`SELECT * FROM reports ${where} ORDER BY last_seen DESC LIMIT ?`)
        .bind(...binds)
        .all<D1RowShape>();
      return (res.results ?? []).map(toRow);
    },
  };
}
