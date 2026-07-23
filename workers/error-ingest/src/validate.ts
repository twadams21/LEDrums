import type { BackupBatch, IngestBatch, WireBackup, WireBreadcrumb, WireEnvelope, WireReport } from './types';

/** Thrown on a malformed batch — the fetch handler maps it to a 400. */
export class ValidationError extends Error {}

// Defensive server-side caps (the shipper already caps, but the Worker is the trust boundary). A
// leaked token can annoy, not damage — oversized input is rejected outright.
export const MAX_REPORTS_PER_BATCH = 500;
export const MAX_MESSAGE_LEN = 8_000;
export const MAX_STACK_LEN = 32_000;
export const MAX_BREADCRUMBS = 50;
export const MAX_STR = 512; // envelope + breadcrumb scalar fields

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string, max = MAX_STR): string {
  if (typeof v !== 'string') throw new ValidationError(`${field} must be a string`);
  if (v.length > max) throw new ValidationError(`${field} exceeds ${max} chars`);
  return v;
}

function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`${field} must be a finite number`);
  return v;
}

function envelope(v: unknown): WireEnvelope {
  if (!isObject(v)) throw new ValidationError('envelope must be an object');
  return {
    machine: str(v.machine, 'envelope.machine'),
    version: str(v.version, 'envelope.version'),
    engineMode: str(v.engineMode, 'envelope.engineMode'),
    platform: str(v.platform, 'envelope.platform'),
    osRelease: str(v.osRelease, 'envelope.osRelease'),
    session: str(v.session, 'envelope.session'),
    uptimeMs: num(v.uptimeMs, 'envelope.uptimeMs'),
    origin: str(v.origin, 'envelope.origin'),
  };
}

function breadcrumb(v: unknown): WireBreadcrumb {
  if (!isObject(v)) throw new ValidationError('breadcrumb must be an object');
  return {
    time: num(v.time, 'breadcrumb.time'),
    type: str(v.type, 'breadcrumb.type'),
    source: str(v.source, 'breadcrumb.source'),
    label: str(v.label, 'breadcrumb.label', MAX_MESSAGE_LEN),
  };
}

function report(v: unknown): WireReport {
  if (!isObject(v)) throw new ValidationError('report must be an object');
  const breadcrumbs = v.breadcrumbs;
  if (!Array.isArray(breadcrumbs)) throw new ValidationError('report.breadcrumbs must be an array');
  if (breadcrumbs.length > MAX_BREADCRUMBS) throw new ValidationError('report.breadcrumbs too long');
  return {
    dedupKey: str(v.dedupKey, 'report.dedupKey', MAX_MESSAGE_LEN),
    envelope: envelope(v.envelope),
    message: str(v.message, 'report.message', MAX_MESSAGE_LEN),
    stack: v.stack === undefined ? undefined : str(v.stack, 'report.stack', MAX_STACK_LEN),
    breadcrumbs: breadcrumbs.map(breadcrumb),
    count: num(v.count, 'report.count'),
    firstSeenMs: num(v.firstSeenMs, 'report.firstSeenMs'),
    lastSeenMs: num(v.lastSeenMs, 'report.lastSeenMs'),
  };
}

/** Parse + validate an ingest batch body. Throws {@link ValidationError} on any malformed input. */
export function parseIngestBatch(body: unknown): IngestBatch {
  if (!isObject(body)) throw new ValidationError('body must be an object');
  const reports = body.reports;
  if (!Array.isArray(reports)) throw new ValidationError('reports must be an array');
  if (reports.length > MAX_REPORTS_PER_BATCH) throw new ValidationError('too many reports in one batch');
  const dropped = body.dropped === undefined ? 0 : num(body.dropped, 'dropped');
  return { reports: reports.map(report), dropped };
}

// --- Project backups (#123) --------------------------------------------------

export const MAX_BACKUPS_PER_BATCH = 100;
export const MAX_KEY_SEGMENT_LEN = 200;

/** A path segment (`machine`, `key`) is safe to compose into an R2 object key iff it is a non-empty,
 * bounded string with no separators or dot-dot — the Worker is the trust boundary for the key, so a
 * leaked token can never traverse out of the `backups/` prefix or collide across machines. */
export function safeKeySegment(v: unknown, field: string): string {
  const s = str(v, field, MAX_KEY_SEGMENT_LEN);
  if (s.length === 0) throw new ValidationError(`${field} must be non-empty`);
  if (s.includes('/') || s.includes('\\') || s.includes('..')) throw new ValidationError(`${field} has an illegal path char`);
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError(`${field} has a control char`);
  return s;
}

function backup(v: unknown): WireBackup {
  if (!isObject(v)) throw new ValidationError('backup must be an object');
  if (v.bundle === undefined) throw new ValidationError('backup.bundle is required');
  return {
    machine: safeKeySegment(v.machine, 'backup.machine'),
    key: safeKeySegment(v.key, 'backup.key'),
    createdAt: num(v.createdAt, 'backup.createdAt'),
    reason: str(v.reason, 'backup.reason'),
    bundle: v.bundle,
  };
}

/**
 * Parse + validate a backups batch. The generic shipper posts items under the `reports` key (the
 * transport is payload-agnostic), so we read `body.reports` here too — the ROUTE, not the key,
 * distinguishes a backup batch from an error batch. Throws {@link ValidationError} on bad input.
 */
export function parseBackupBatch(body: unknown): BackupBatch {
  if (!isObject(body)) throw new ValidationError('body must be an object');
  const items = body.reports;
  if (!Array.isArray(items)) throw new ValidationError('reports must be an array');
  if (items.length > MAX_BACKUPS_PER_BATCH) throw new ValidationError('too many backups in one batch');
  const dropped = body.dropped === undefined ? 0 : num(body.dropped, 'dropped');
  return { backups: items.map(backup), dropped };
}
