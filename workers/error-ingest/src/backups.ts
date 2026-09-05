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
      const prefix = `${BACKUP_PREFIX}${machine}/`;
      const objects: BackupObject[] = [];
      let res = await bucket.list({ prefix });
      while (true) {
        for (const o of res.objects) {
          objects.push({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() });
        }
        if (!res.truncated) break;
        res = await bucket.list({ prefix, cursor: res.cursor });
      }
      return objects.sort((a, b) => b.uploaded - a.uploaded);
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? obj.text() : null;
    },
  };
}
