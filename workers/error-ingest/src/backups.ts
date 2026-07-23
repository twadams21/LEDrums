import type { R2Bucket } from './cf';
import type { BackupObject } from './types';

/**
 * The R2 persistence seam for project backups (#123) — abstracted (like {@link ReportStore} for D1)
 * so the handlers are unit-testable with an in-memory fake, no live Cloudflare. Objects live under
 * `backups/<machine>/<key>`; remote retention is a bucket lifecycle rule (90-day expiry), not code.
 */
export interface BackupStore {
  /** Store one snapshot bundle body at `backups/<machine>/<key>`. */
  put(machine: string, key: string, body: string): Promise<void>;
  /** List a machine's snapshots (metadata only), newest-uploaded first. */
  list(machine: string): Promise<BackupObject[]>;
  /** Fetch a stored bundle body by its full object key, or null when absent. */
  get(key: string): Promise<string | null>;
}

/** The R2 object-key prefix all backups live under — the trust boundary for `get`. */
export const BACKUP_PREFIX = 'backups/';

/** Compose the full R2 object key for a machine's snapshot. */
export function backupKey(machine: string, key: string): string {
  return `${BACKUP_PREFIX}${machine}/${key}`;
}

/** R2-backed {@link BackupStore}. */
export function r2Store(bucket: R2Bucket): BackupStore {
  return {
    async put(machine, key, body) {
      await bucket.put(backupKey(machine, key), body);
    },
    async list(machine) {
      const res = await bucket.list({ prefix: `${BACKUP_PREFIX}${machine}/` });
      return res.objects
        .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() }))
        .sort((a, b) => b.uploaded - a.uploaded);
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? obj.text() : null;
    },
  };
}
