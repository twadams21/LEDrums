import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from './projects';
import { writeFileAtomic, writeFileAtomicSync } from './atomic-file';

// `ShowLibraryBlob` is part of the WS wire contract, so it is defined once in
// `@ledrums/protocol` (app-shared) and re-exported here for the server's existing
// `./show-library` import paths. The authored show library is WEB-OWNED state — its schema
// (`ShowLibrary`, `AuthoredState`) lives in apps/web and the server can't import it. So the
// server persists it as an OPAQUE versioned blob: it stores + rebroadcasts the JSON verbatim
// and never interprets `data`; the web (de)serializes/validates it on adopt.
export type { ShowLibraryBlob } from '@ledrums/protocol';

import type { ShowLibraryBlob } from '@ledrums/protocol';

/** Machine-local show-library file, written alongside the project autosave slot. Like the
 * live project it follows the repo's `.local.json` convention (gitignored runtime state, never
 * a hand-edited seed) — see apps/server/.gitignore. */
export const SHOW_LIBRARY_FILE = 'default.shows.local.json';

/** Resolve the final path for the machine-local show library file. */
export function showLibraryPath(dir: string = PROJECTS_DIR): string {
  return join(dir, SHOW_LIBRARY_FILE);
}

export type ShowLibraryLoadSource = 'absent' | 'loaded' | 'invalid';

export function inspectShowLibraryFile(dir: string = PROJECTS_DIR): { path: string; source: ShowLibraryLoadSource } {
  const file = showLibraryPath(dir);
  if (!existsSync(file)) return { path: file, source: 'absent' };
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return { path: file, source: isBlob(parsed) ? 'loaded' : 'invalid' };
  } catch {
    return { path: file, source: 'invalid' };
  }
}

/**
 * Boot-recover the persisted show library, or `null` when it is absent, unreadable, or not a
 * versioned envelope. Defensive by design: a missing or junk file means "no library yet" (the
 * web re-seeds the server from its localStorage cache on connect), so this NEVER throws on
 * boot — a corrupt file can't wedge startup. The opaque `data` is not validated here; the web
 * runs `deserializeShowLibrary` on adopt.
 */
export function loadShowLibrary(dir: string = PROJECTS_DIR): ShowLibraryBlob | null {
  const file = showLibraryPath(dir);
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isBlob(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A parsed value is a usable blob iff it is an object carrying a numeric `version`. */
function isBlob(v: unknown): v is ShowLibraryBlob {
  return typeof v === 'object' && v !== null && typeof (v as { version?: unknown }).version === 'number';
}

/**
 * Atomically persist the library blob to {@link SHOW_LIBRARY_FILE} — write a unique temp file
 * and `rename` into place, so a crash never leaves a half-written file (the temp lives in the
 * same dir/filesystem as the target, making the rename atomic). Synchronous; used for the
 * shutdown flush.
 */
export function saveShowLibrary(blob: ShowLibraryBlob, dir: string = PROJECTS_DIR): void {
  writeFileAtomicSync(showLibraryPath(dir), JSON.stringify(blob, null, 2));
}

/**
 * Async, atomic library write (temp file + `rename`) — same atomicity as
 * {@link saveShowLibrary}, but the disk IO is off the main tick, so the debounced autosaver
 * never blocks the engine/render loop.
 */
export async function saveShowLibraryAsync(blob: ShowLibraryBlob, dir: string = PROJECTS_DIR): Promise<void> {
  await writeFileAtomic(showLibraryPath(dir), JSON.stringify(blob, null, 2));
}
