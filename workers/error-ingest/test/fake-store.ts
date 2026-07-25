import type { ReportStore } from '../src/store';
import type { ReportRow } from '../src/types';

/** In-memory {@link ReportStore} mirroring the D1 semantics — unique by (machine,version,session,
 * dedupKey), upsert bumps count/last_seen without changing received_at. For handler unit tests. */
export function fakeStore(seed: ReportRow[] = []): ReportStore & { rows: ReportRow[] } {
  const rows: ReportRow[] = [...seed];
  const uniqueOf = (r: { machine: string; version: string; session: string; dedupKey: string }): string =>
    `${r.machine}|${r.version}|${r.session}|${r.dedupKey}`;
  return {
    rows,
    countCreatedSince: (machine, sinceMs) =>
      Promise.resolve(rows.filter((r) => r.machine === machine && r.receivedAt >= sinceMs).length),
    dedupKeySeen: (machine, version, dedupKey) =>
      Promise.resolve(rows.some((r) => r.machine === machine && r.version === version && r.dedupKey === dedupKey)),
    upsert: (row) => {
      const key = uniqueOf(row);
      const existing = rows.find((r) => uniqueOf(r) === key);
      if (existing) {
        existing.count = Math.max(existing.count, row.count);
        existing.lastSeenMs = row.lastSeenMs;
      } else {
        rows.push({ ...row });
      }
      return Promise.resolve();
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
