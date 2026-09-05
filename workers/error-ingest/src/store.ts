import type { D1Database } from './cf';
import type { ReportRow, WireBreadcrumb } from './types';

/** Persistence owns admission, not the request: callers cannot split the budget check from its
 * write or the notification claim from report persistence. SQL is tested against local SQLite. */
export interface ReportStore {
  /** Atomically admit + upsert a report and claim its first notification. Existing identities
   * (machine, version, dedupKey) bypass the budget, including reports from a new session.
   * `claimed` means this call owns one best-effort attempt, NOT that delivery happened. */
  admit(row: ReportRow, budget: { sinceMs: number; maxNewKeys: number }): Promise<{
    accepted: boolean;
    claimed: boolean;
  }>;
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

/** D1 batch is the transaction boundary: no request can observe a claim without its report or
 * race between counting recent claims and inserting one. The claims ledger is permanent (no TTL):
 * expiry frees budget, never makes an old identity new again. Apply the backfill before deployment. */
export function d1Store(db: D1Database): ReportStore {
  return {
    async admit(r, budget) {
      const claim = db.prepare(
        `INSERT INTO notification_claims (machine, version, dedup_key, claimed_at)
         SELECT ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM notification_claims WHERE machine = ? AND claimed_at >= ?) < ?
         ON CONFLICT(machine, version, dedup_key) DO NOTHING
         RETURNING 1 AS claimed`,
      ).bind(r.machine, r.version, r.dedupKey, r.receivedAt, r.machine, budget.sinceMs, budget.maxNewKeys);
      const report = db
        .prepare(
          `INSERT INTO reports
             (machine, version, engine_mode, platform, os_release, session, origin, dedup_key,
              message, stack, breadcrumbs, count, first_seen, last_seen, received_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM notification_claims WHERE machine = ? AND version = ? AND dedup_key = ?)
           ON CONFLICT(machine, version, session, dedup_key) DO UPDATE SET
             count = MAX(count, excluded.count),
             last_seen = excluded.last_seen
           RETURNING 1 AS accepted`,
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
          r.machine,
          r.version,
          r.dedupKey,
        );
      const [claimResult, reportResult] = await db.batch([claim, report]);
      if (!claimResult?.success || !reportResult?.success) throw new Error('Report admission failed');
      return {
        accepted: (reportResult.results?.length ?? 0) > 0,
        claimed: (claimResult.results?.length ?? 0) > 0,
      };
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
