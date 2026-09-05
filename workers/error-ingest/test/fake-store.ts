import type { ReportStore } from '../src/store';
import type { ReportRow } from '../src/types';

/** In-memory {@link ReportStore} mirroring the D1 semantics — unique by (machine,version,session,
 * dedupKey), upsert bumps count/last_seen without changing received_at. For handler unit tests. */
export function fakeStore(seed: ReportRow[] = []): ReportStore & { rows: ReportRow[] } {
  const rows: ReportRow[] = [...seed];
  const uniqueOf = (r: { machine: string; version: string; session: string; dedupKey: string }): string =>
    `${r.machine}|${r.version}|${r.session}|${r.dedupKey}`;
  const identityOf = (r: ReportRow) => JSON.stringify([r.machine, r.version, r.dedupKey]);
  const claims = new Map<string, ReportRow>();
  for (const row of seed) {
    const prior = claims.get(identityOf(row));
    if (!prior || row.receivedAt < prior.receivedAt) claims.set(identityOf(row), row);
  }
  return {
    rows,
    // Handler branch tests only. Concurrency/rollback claims are verified using actual SQLite in
    // ingest-atomicity.test.ts, NOT by trusting this independent implementation.
    admit: (row, budget) => {
      const claimed = !claims.has(identityOf(row));
      if (claimed) {
        const used = [...claims.values()].filter((r) => r.machine === row.machine && r.receivedAt >= budget.sinceMs).length;
        if (used >= budget.maxNewKeys) return Promise.resolve({ accepted: false, claimed: false });
        claims.set(identityOf(row), { ...row });
      }
      const key = uniqueOf(row);
      const existing = rows.find((r) => uniqueOf(r) === key);
      if (existing) {
        existing.count = Math.max(existing.count, row.count);
        existing.lastSeenMs = row.lastSeenMs;
      } else {
        rows.push({ ...row });
      }
      return Promise.resolve({ accepted: true, claimed });
    },
    list: (filter) => {
      let out = rows.filter(
        (r) =>
          (!filter.machine || r.machine === filter.machine) &&
          (!filter.version || r.version === filter.version) &&
          (filter.since == null || r.lastSeenMs >= filter.since),
      );
      out = out.sort((a, b) => b.lastSeenMs - a.lastSeenMs).slice(0, filter.limit);
      return Promise.resolve(out);
    },
  };
}
