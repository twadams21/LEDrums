import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-file';
import { writeArchiveOnce } from './named-blob-store';
import { SerialQueue } from './serial-queue';
import { SHOW_LIBRARY_FILE } from './show-library';
import { SONG_LIBRARY_FILE } from './song-library';
import type { SnapshotFiles } from './backups/snapshot-store';

/** One rename commits all three live blobs. Old separate files are import-only once this
 * envelope exists; a torn three-file restore is therefore impossible on clean restart. */
export const LIVE_STATE_FILE = 'default.state.local.json';

/** The library slots whose old formats are archived before a newer format replaces them. */
const ARCHIVED_SLOTS = [['showLibrary', SHOW_LIBRARY_FILE], ['songLibrary', SONG_LIBRARY_FILE]] as const;
type ArchivedSlot = (typeof ARCHIVED_SLOTS)[number][0];
type SlotVersions = Record<ArchivedSlot, number | null>;

function blobVersion(blob: unknown): number | null {
  const version = typeof blob === 'object' && blob !== null ? (blob as { version?: unknown }).version : undefined;
  return typeof version === 'number' && Number.isFinite(version) ? version : null;
}

function slotVersions(files: Partial<SnapshotFiles> | null | undefined): SlotVersions {
  return { showLibrary: blobVersion(files?.showLibrary), songLibrary: blobVersion(files?.songLibrary) };
}

/** What is on disk now: the envelope text plus its library versions (parsed lazily for archive). */
interface Persisted { text: string | null; versions: SlotVersions }

function parseEnvelope(text: string): SnapshotFiles | null {
  try {
    const parsed = JSON.parse(text) as { files?: SnapshotFiles };
    return parsed.files ?? null;
  } catch {
    return null;
  }
}

export function createProjectStorage(dir: string) {
  const queue = new SerialQueue();
  const path = join(dir, LIVE_STATE_FILE);
  /** `undefined` until the envelope has been read or written in this process. */
  let persisted: Persisted | undefined;

  async function readText(): Promise<string | null> {
    return readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  }

  /** Before a newer-format library replaces an older one on disk, keep a one-time archive copy
   * of the old blob beside the envelope (for example `default.shows.v2.local.json`). An
   * existing archive is never overwritten. A failed archive write fails the save, so the old
   * blob is never replaced unprotected. */
  async function archiveReplacedFormats(next: SlotVersions): Promise<void> {
    if (persisted === undefined) {
      const text = await readText();
      persisted = { text, versions: slotVersions(text === null ? null : parseEnvelope(text)) };
    }
    const current = persisted;
    let old: SnapshotFiles | null | undefined;
    for (const [slot, file] of ARCHIVED_SLOTS) {
      const was = current.versions[slot];
      const now = next[slot];
      if (was === null || now === null || now <= was) continue;
      old ??= current.text === null ? null : parseEnvelope(current.text);
      if (old?.[slot]) await writeArchiveOnce(dir, file, was, old[slot]);
    }
  }

  return {
    async read(): Promise<SnapshotFiles | null> {
      const text = await readText();
      if (text === null) {
        persisted = { text: null, versions: slotVersions(null) };
        return null;
      }
      const parsed = JSON.parse(text);
      if (parsed.version !== 1 || !parsed.files || !('project' in parsed.files)
        || !('showLibrary' in parsed.files) || !('songLibrary' in parsed.files)) {
        throw new Error('Invalid live-state envelope; refusing stale three-file fallback');
      }
      persisted = { text, versions: slotVersions(parsed.files) };
      return parsed.files as SnapshotFiles;
    },
    save(files: SnapshotFiles): Promise<void> {
      // Capture the revision NOW (callers keep mutating the live project after scheduling).
      const text = JSON.stringify({ version: 1, files });
      const versions = slotVersions(files);
      return queue.run(async () => {
        await archiveReplacedFormats(versions);
        await writeFileAtomic(path, text);
        persisted = { text, versions };
      });
    },
    drain: () => queue.drain(),
  };
}
