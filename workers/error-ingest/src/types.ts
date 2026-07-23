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
