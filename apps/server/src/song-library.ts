import { createNamedBlobStore, type BlobLoadSource } from './named-blob-store';
import { PROJECTS_DIR } from './projects';

// `SongLibraryBlob` is the song-library counterpart of `ShowLibraryBlob`: a WEB-OWNED opaque
// versioned blob (its schema — `SongLibrary`, `LibrarySong` — lives in apps/web). The server
// persists it VERBATIM as a second named blob and rebroadcasts it; the web validates it on adopt.
// A thin wrapper over the shared `named-blob-store` seam, identical in mechanics to show-library.
export type { SongLibraryBlob } from '@ledrums/protocol';

import type { SongLibraryBlob } from '@ledrums/protocol';

/** Machine-local song-library file, alongside the project + show-library autosave slots (same
 * `.local.json` gitignored-runtime-state convention — see apps/server/.gitignore). */
export const SONG_LIBRARY_FILE = 'default.songs.local.json';

const store = createNamedBlobStore<SongLibraryBlob>(SONG_LIBRARY_FILE);

/** Back-compat alias for the shared {@link BlobLoadSource} (mirrors ShowLibraryLoadSource). */
export type SongLibraryLoadSource = BlobLoadSource;

/** Resolve the final path for the machine-local song library file. */
export function songLibraryPath(dir: string = PROJECTS_DIR): string {
  return store.path(dir);
}

/** Inspect the song-library file's state for startup diagnostics (absent/loaded/invalid). */
export function inspectSongLibraryFile(dir: string = PROJECTS_DIR): { path: string; source: SongLibraryLoadSource } {
  return store.inspect(dir);
}

/**
 * Boot-recover the persisted song library, or `null` when it is absent, unreadable, or not a
 * versioned envelope. Defensive — a missing / junk file means "no song library yet" and NEVER
 * throws on boot (the web re-seeds from its localStorage cache on connect). The opaque `data` is
 * validated web-side via `deserializeSongLibrary` on adopt.
 */
export function loadSongLibrary(dir: string = PROJECTS_DIR): SongLibraryBlob | null {
  return store.load(dir);
}

/** Atomically persist the song-library blob (sync — shutdown flush). */
export function saveSongLibrary(blob: SongLibraryBlob, dir: string = PROJECTS_DIR): void {
  store.save(blob, dir);
}

/** Async, atomic song-library write off the main tick (the debounced autosaver). */
export async function saveSongLibraryAsync(blob: SongLibraryBlob, dir: string = PROJECTS_DIR): Promise<void> {
  await store.saveAsync(blob, dir);
}
