import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from './projects';
import { writeFileAtomic, writeFileAtomicSync } from './atomic-file';

/* Named opaque-blob store — the seam behind the server's WEB-OWNED persisted libraries (the
   authored show library, and now the song library). Each is a versioned JSON envelope whose
   `data` schema lives in apps/web; the server stores + rebroadcasts it VERBATIM and never
   interprets `data`. This factory captures that one pattern — a machine-local `.local.json` file
   written atomically, boot-recovered defensively (a missing/corrupt file is "no library yet", so
   it NEVER throws on boot), and inspectable for startup diagnostics — parametrized only by the
   filename. `show-library.ts` and `song-library.ts` are thin wrappers over one instance each. */

/** The minimum a persisted blob must be for the server to treat it as usable: an object carrying
    a numeric `version`. The `data` payload is opaque (web-owned) and never validated here. */
export interface VersionedBlob {
  version: number;
  data: unknown;
}

export type BlobLoadSource = 'absent' | 'loaded' | 'invalid';

export interface NamedBlobStore<B extends VersionedBlob> {
  /** The machine-local filename this store reads/writes (e.g. `default.shows.local.json`). */
  readonly file: string;
  /** Resolve the final path for the blob file under `dir`. */
  path(dir?: string): string;
  /** Inspect the file's state for startup diagnostics without loading it into the app. */
  inspect(dir?: string): { path: string; source: BlobLoadSource };
  /** Boot-recover the blob, or null when absent / unreadable / not a versioned envelope. */
  load(dir?: string): B | null;
  /** Atomically persist the blob (sync — used for the shutdown flush). */
  save(blob: B, dir?: string): void;
  /** Atomically persist the blob off the main tick (async — the debounced autosaver). */
  saveAsync(blob: B, dir?: string): Promise<void>;
}

/** A parsed value is a usable blob iff it is an object carrying a numeric `version`. */
function isVersionedBlob(v: unknown): v is VersionedBlob {
  return typeof v === 'object' && v !== null && typeof (v as { version?: unknown }).version === 'number';
}

/**
 * Build a {@link NamedBlobStore} for `file`. All IO is defensive: `load`/`inspect` swallow read +
 * parse errors (a corrupt file can't wedge startup), and writes go through the atomic temp+rename
 * helpers so a crash never leaves a half-written file.
 */
export function createNamedBlobStore<B extends VersionedBlob>(file: string): NamedBlobStore<B> {
  const path = (dir: string = PROJECTS_DIR): string => join(dir, file);

  return {
    file,
    path,
    inspect(dir: string = PROJECTS_DIR) {
      const f = path(dir);
      if (!existsSync(f)) return { path: f, source: 'absent' as const };
      try {
        const parsed: unknown = JSON.parse(readFileSync(f, 'utf8'));
        return { path: f, source: isVersionedBlob(parsed) ? ('loaded' as const) : ('invalid' as const) };
      } catch {
        return { path: f, source: 'invalid' as const };
      }
    },
    load(dir: string = PROJECTS_DIR): B | null {
      const f = path(dir);
      if (!existsSync(f)) return null;
      try {
        const parsed: unknown = JSON.parse(readFileSync(f, 'utf8'));
        return isVersionedBlob(parsed) ? (parsed as B) : null;
      } catch {
        return null;
      }
    },
    save(blob: B, dir: string = PROJECTS_DIR): void {
      writeFileAtomicSync(path(dir), JSON.stringify(blob, null, 2));
    },
    async saveAsync(blob: B, dir: string = PROJECTS_DIR): Promise<void> {
      await writeFileAtomic(path(dir), JSON.stringify(blob, null, 2));
    },
  };
}
