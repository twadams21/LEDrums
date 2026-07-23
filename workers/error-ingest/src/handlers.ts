import type { DiscordNotifier } from './discord';
import type { ReportStore } from './store';
import type { IngestBatch, ReportRow, WireReport } from './types';

/** A plain result the fetch entry turns into a `Response` — keeps handlers framework-free + testable. */
export interface HandlerResult {
  status: number;
  body: unknown;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

function toRow(r: WireReport, now: number): ReportRow {
  return {
    machine: r.envelope.machine,
    version: r.envelope.version,
    engineMode: r.envelope.engineMode,
    platform: r.envelope.platform,
    osRelease: r.envelope.osRelease,
    session: r.envelope.session,
    origin: r.envelope.origin,
    dedupKey: r.dedupKey,
    message: r.message,
    stack: r.stack ?? null,
    breadcrumbs: r.breadcrumbs,
    count: r.count,
    firstSeenMs: r.firstSeenMs,
    lastSeenMs: r.lastSeenMs,
    receivedAt: now,
  };
}

export interface IngestDeps {
  store: ReportStore;
  notify: DiscordNotifier;
  now: number;
  rateWindowMs: number;
  rateMaxNewRows: number;
}

/**
 * Ingest a validated batch: upsert each report, rate-limiting only GENUINELY-NEW keys per machine
 * (repeats always upsert their count bump — never dropped), and firing the Discord webhook exactly
 * once per (machine, version, dedupKey) — its first occurrence. Repeat-count updates never ping.
 */
export async function ingestBatch(deps: IngestDeps, batch: IngestBatch): Promise<HandlerResult> {
  const { store, notify, now, rateWindowMs, rateMaxNewRows } = deps;
  const budgets = new Map<string, number>(); // remaining new-row budget per machine, this request
  let accepted = 0;
  let rateLimited = 0;
  let pinged = 0;

  for (const r of batch.reports) {
    const machine = r.envelope.machine;
    const version = r.envelope.version;
    const seen = await store.dedupKeySeen(machine, version, r.dedupKey);

    if (!seen) {
      // A new unique error — subject to the per-machine rate limit (a leaked token can annoy, not
      // damage). Repeats (seen) bypass this entirely so a real machine's count bumps always land.
      if (!budgets.has(machine)) {
        const used = await store.countCreatedSince(machine, now - rateWindowMs);
        budgets.set(machine, Math.max(0, rateMaxNewRows - used));
      }
      const remaining = budgets.get(machine)!;
      if (remaining <= 0) {
        rateLimited++;
        continue;
      }
      budgets.set(machine, remaining - 1);
    }

    const row = toRow(r, now);
    await store.upsert(row);
    accepted++;
    if (!seen) {
      await notify(row);
      pinged++;
    }
  }

  return {
    status: 200,
    body: { accepted, rateLimited, pinged, droppedUpstream: batch.dropped },
  };
}

/** Read reports filtered by machine/version/since (newest first). Consumer is Trent's AI agent via curl. */
export async function listReports(store: ReportStore, url: URL): Promise<HandlerResult> {
  const machine = url.searchParams.get('machine') ?? undefined;
  const version = url.searchParams.get('version') ?? undefined;
  const sinceRaw = url.searchParams.get('since');
  const limitRaw = url.searchParams.get('limit');

  const since = sinceRaw != null && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : undefined;
  let limit = limitRaw != null && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : DEFAULT_LIST_LIMIT;
  limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)));

  const reports = await store.list({ machine, version, since, limit });
  return { status: 200, body: { reports, count: reports.length } };
}
