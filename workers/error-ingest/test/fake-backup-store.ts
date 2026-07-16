import { backupKey, type BackupStore } from '../src/backups';
import type { BackupObject } from '../src/types';

/** In-memory {@link BackupStore} mirroring R2 semantics — keyed by full object key, list filters by
 * the machine prefix, newest-uploaded first. `uploaded` is an injected counter so order is
 * deterministic without a real clock. For handler unit tests (no live Cloudflare). */
export function fakeBackupStore(): BackupStore & { objects: Map<string, string>; uploads: Map<string, number> } {
  const objects = new Map<string, string>();
  const uploads = new Map<string, number>();
  let seq = 0;
  return {
    objects,
    uploads,
    put(machine, key, body) {
      const full = backupKey(machine, key);
      objects.set(full, body);
      uploads.set(full, seq++);
      return Promise.resolve();
    },
    list(machine) {
      const prefix = `backups/${machine}/`;
      const out: BackupObject[] = [];
      for (const [key, body] of objects) {
        if (key.startsWith(prefix)) out.push({ key, size: body.length, uploaded: uploads.get(key) ?? 0 });
      }
      out.sort((a, b) => b.uploaded - a.uploaded);
      return Promise.resolve(out);
    },
    get(key) {
      return Promise.resolve(objects.has(key) ? objects.get(key)! : null);
    },
  };
}
