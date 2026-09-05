import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-file';
import { SerialQueue } from './serial-queue';
import type { SnapshotFiles } from './backups/snapshot-store';

/** One rename commits all three live blobs. Old separate files are import-only once this
 * envelope exists; a torn three-file restore is therefore impossible on clean restart. */
export const LIVE_STATE_FILE = 'default.state.local.json';
export function createProjectStorage(dir: string) {
  const queue = new SerialQueue();
  const path = join(dir, LIVE_STATE_FILE);
  return {
    async read(): Promise<SnapshotFiles | null> {
      const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (text === null) return null;
      const parsed = JSON.parse(text);
      if (parsed.version !== 1 || !parsed.files || !('project' in parsed.files)
        || !('showLibrary' in parsed.files) || !('songLibrary' in parsed.files)) {
        throw new Error('Invalid live-state envelope; refusing stale three-file fallback');
      }
      return parsed.files as SnapshotFiles;
    },
    save(files: SnapshotFiles): Promise<void> {
      const text = JSON.stringify({ version: 1, files });
      return queue.run(() => writeFileAtomic(path, text));
    },
    drain: () => queue.drain(),
  };
}
