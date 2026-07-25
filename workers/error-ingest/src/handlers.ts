import type { BackupStore } from './backups';
import { BACKUP_PREFIX } from './backups';
import type { DiscordNotifier } from './discord';
import type { ReportStore } from './store';
import type { BackupBatch, IngestBatch, ReportRow, WireReport } from './types';

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

// --- Project backups (#123) --------------------------------------------------

/** Ingest a validated backups batch: store each bundle body to R2 under `backups/<machine>/<key>`.
 * Bodies are opaque (the Worker never interprets a bundle). Returns per-batch accept + drop counts. */
export async function ingestBackups(store: BackupStore, batch: BackupBatch): Promise<HandlerResult> {
  let accepted = 0;
  for (const b of batch.backups) {
    await store.put(b.machine, b.key, JSON.stringify(b.bundle));
    accepted++;
  }
  return { status: 200, body: { accepted, droppedUpstream: batch.dropped } };
}

/** List a machine's off-site snapshots (metadata only, newest first). `machine` is required so the
 * listing never spans machines. Consumer is the in-app dialog (local) or Trent's AI agent (remote). */
export async function listBackups(store: BackupStore, url: URL): Promise<HandlerResult> {
  const machine = url.searchParams.get('machine');
  if (!machine) return { status: 400, body: { error: 'machine is required' } };
  const objects = await store.list(machine);
  return { status: 200, body: { objects, count: objects.length } };
}

/** Fetch one stored bundle body by its full R2 key. The key MUST be inside the `backups/` prefix —
 * the read trust boundary — so a leaked token can never read arbitrary objects. */
export async function getBackup(store: BackupStore, url: URL): Promise<HandlerResult> {
  const key = url.searchParams.get('key');
  if (!key) return { status: 400, body: { error: 'key is required' } };
  if (!key.startsWith(BACKUP_PREFIX) || key.includes('..')) return { status: 400, body: { error: 'invalid key' } };
  const body = await store.get(key);
  if (body === null) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body };
}
