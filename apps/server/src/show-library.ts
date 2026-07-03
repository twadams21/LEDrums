import { createNamedBlobStore, type BlobLoadSource } from './named-blob-store';
import { PROJECTS_DIR } from './projects';

// `ShowLibraryBlob` is part of the WS wire contract, so it is defined once in
// `@ledrums/protocol` (app-shared) and re-exported here for the server's existing
// `./show-library` import paths. The authored show library is WEB-OWNED state — its schema
// (`ShowLibrary`, `AuthoredState`) lives in apps/web and the server can't import it. So the
// server persists it as an OPAQUE versioned blob: it stores + rebroadcasts the JSON verbatim
// and never interprets `data`; the web (de)serializes/validates it on adopt. The IO mechanics
// live in the shared `named-blob-store` seam (the song library is a second instance).
export type { ShowLibraryBlob } from '@ledrums/protocol';

import type { ShowLibraryBlob } from '@ledrums/protocol';

/** Machine-local show-library file, written alongside the project autosave slot. Like the
 * live project it follows the repo's `.local.json` convention (gitignored runtime state, never
 * a hand-edited seed) — see apps/server/.gitignore. */
export const SHOW_LIBRARY_FILE = 'default.shows.local.json';

const store = createNamedBlobStore<ShowLibraryBlob>(SHOW_LIBRARY_FILE);

/** Back-compat alias for the shared {@link BlobLoadSource}. */
export type ShowLibraryLoadSource = BlobLoadSource;

/** Resolve the final path for the machine-local show library file. */
export function showLibraryPath(dir: string = PROJECTS_DIR): string {
  return store.path(dir);
}

export function inspectShowLibraryFile(dir: string = PROJECTS_DIR): { path: string; source: ShowLibraryLoadSource } {
  return store.inspect(dir);
}

/**
 * Boot-recover the persisted show library, or `null` when it is absent, unreadable, or not a
 * versioned envelope. Defensive by design: a missing or junk file means "no library yet" (the
 * web re-seeds the server from its localStorage cache on connect), so this NEVER throws on
 * boot — a corrupt file can't wedge startup. The opaque `data` is not validated here; the web
 * runs `deserializeShowLibrary` on adopt.
 */
export function loadShowLibrary(dir: string = PROJECTS_DIR): ShowLibraryBlob | null {
  return store.load(dir);
}

/**
 * Atomically persist the library blob to {@link SHOW_LIBRARY_FILE} — write a unique temp file
 * and `rename` into place, so a crash never leaves a half-written file. Synchronous; used for the
 * shutdown flush.
 */
export function saveShowLibrary(blob: ShowLibraryBlob, dir: string = PROJECTS_DIR): void {
  store.save(blob, dir);
}

/**
 * Async, atomic library write — same atomicity as {@link saveShowLibrary}, but the disk IO is off
 * the main tick, so the debounced autosaver never blocks the engine/render loop.
 */
export async function saveShowLibraryAsync(blob: ShowLibraryBlob, dir: string = PROJECTS_DIR): Promise<void> {
  await store.saveAsync(blob, dir);
}
