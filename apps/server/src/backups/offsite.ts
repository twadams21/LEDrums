import type { SnapshotBundle, SnapshotMeta, SnapshotReason } from './snapshot-store';

/**
 * Off-site backup wire shaping (#123). Every local snapshot is pushed off-site through the SAME
 * generic ship machinery (`ship-queue` + `createHttpTransport`) the error Reporter uses — a second
 * disk-backed queue posting to a `/backups` route on the same Cloudflare Worker (no third shipping
 * mechanism). This module owns only the two backups-specific bits: the record shape the Worker
 * stores in R2, and deriving the `/backups` endpoint from the shared telemetry ingest endpoint.
 */

/** One snapshot as it ships off-site: identity + the full JSON bundle. The Worker writes it to R2
 * under `backups/<machine>/<key>` (its remote retention is a bucket lifecycle rule, not code). */
export interface BackupRecord {
  /** Machine name — the R2 key namespace, so one machine's snapshots never collide with another's. */
  machine: string;
  /** The snapshot's stable id (`<createdAt>-<reason>`), used as the R2 object key suffix. */
  key: string;
  createdAt: number;
  reason: SnapshotReason;
  /** The full snapshot bundle (project + both libraries), stored verbatim as the R2 object body. */
  bundle: SnapshotBundle;
}

/** Shape a snapshot for off-site shipping. */
export function toBackupRecord(machine: string, meta: SnapshotMeta, bundle: SnapshotBundle): BackupRecord {
  return { machine, key: meta.id, createdAt: meta.createdAt, reason: meta.reason, bundle };
}

/**
 * Derive the `/backups` ingest endpoint from the telemetry `/ingest` endpoint (same Worker origin).
 * Reusing the one configured endpoint keeps backups from needing their own env var while still
 * hitting a distinct route. Returns null when the endpoint is unparseable (shipping then stays off).
 */
export function backupsEndpoint(ingestEndpoint: string): string | null {
  try {
    const url = new URL(ingestEndpoint);
    url.pathname = '/backups';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}
