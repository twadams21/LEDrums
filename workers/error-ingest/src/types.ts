// Wire + row shapes for the error-ingest Worker (#122). The Worker stays dumb: it validates the
// token + shape and writes to D1; these types mirror the server Reporter's `ReportRecord` payload
// (apps/server/src/telemetry/envelope.ts) but are duplicated here deliberately — the Worker is a
// separate deploy unit with no import edge back into the app monorepo's packages.

export interface WireEnvelope {
  machine: string;
  version: string;
  engineMode: string;
  platform: string;
  osRelease: string;
  session: string;
  uptimeMs: number;
  origin: string;
}

export interface WireBreadcrumb {
  time: number;
  type: string;
  source: string;
  label: string;
}

/** One report as it arrives on the wire (a `ReportRecord` from the shipper). */
export interface WireReport {
  dedupKey: string;
  envelope: WireEnvelope;
  message: string;
  stack?: string;
  breadcrumbs: WireBreadcrumb[];
  count: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

/** A batch as POSTed by the shipper: reports + the drop-oldest counter that itself ships. */
export interface IngestBatch {
  reports: WireReport[];
  dropped: number;
}

// --- Project backups (#123) --------------------------------------------------
// The backups queue reuses the shipper + the generic HTTP transport, so a batch arrives under the
// same `reports` key. Each item is a `BackupRecord` (mirrors apps/server/src/backups/offsite.ts),
// stored to R2 verbatim under `backups/<machine>/<key>`. The Worker never interprets `bundle`.

/** One snapshot as it ships off-site: identity + the opaque bundle body. */
export interface WireBackup {
  machine: string;
  /** Snapshot id `<createdAt>-<reason>` — the R2 object key suffix. */
  key: string;
  createdAt: number;
  reason: string;
  /** The full snapshot bundle (project + both libraries), stored as the R2 object body verbatim. */
  bundle: unknown;
}

/** A backups batch as POSTed by the shipper (same envelope shape as reports). */
export interface BackupBatch {
  backups: WireBackup[];
  dropped: number;
}

/** One backup object as returned by the list route (metadata only; the body is fetched by key). */
export interface BackupObject {
  key: string;
  size: number;
  uploaded: number;
}

/** A stored/returned report row (flattened envelope + server-stamped `receivedAt`). */
export interface ReportRow {
  id?: number;
  machine: string;
  version: string;
  engineMode: string;
  platform: string;
  osRelease: string;
  session: string;
  origin: string;
  dedupKey: string;
  message: string;
  stack: string | null;
  breadcrumbs: WireBreadcrumb[];
  count: number;
  firstSeenMs: number;
  lastSeenMs: number;
  receivedAt: number;
}
