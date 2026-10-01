import { effectChain, SHOWS_VERSION, SHOWS_VERSION_EFFECTS, SONGS_VERSION, SONGS_VERSION_EFFECTS,
  type voice } from '@ledrums/core';
import { showSchema } from '@ledrums/protocol';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid authored library object');
  return value as Record<string, unknown>;
}

/** The envelope versions the server stores: the effect-chains format it runs, and the retired
 * graph-model format it keeps as an archive. A graph-model library is never run — the server
 * boots it as an empty show and hands the blob to the web client, whose legacy import reads it
 * (effect chains S08). */
const SUPPORTED_VERSIONS = {
  show: [SHOWS_VERSION, SHOWS_VERSION_EFFECTS],
  song: [SONGS_VERSION, SONGS_VERSION_EFFECTS],
} as const;

function versionOf(blob: unknown): unknown {
  return typeof blob === 'object' && blob && 'version' in blob ? blob.version : undefined;
}

/** Fail closed rather than rendering pre-migration hoop ids on a different physical hoop.
 * Browser persistence owns migration. Recovery: migrate a COPY with that pipeline and re-save
 * at a supported version; never repair old data by changing only its version number.
 * Each library is checked on its own: the web pushes them separately, so a show and song
 * library at different formats is a valid (transitional) state, never a boot wedge. */
export function validateLibraryVersions(showLibrary: unknown, songLibrary: unknown): void {
  for (const [kind, blob] of [['show', showLibrary], ['song', songLibrary]] as const) {
    if (blob === null) continue;
    const version = versionOf(blob);
    const expected: readonly unknown[] = SUPPORTED_VERSIONS[kind];
    if (!expected.includes(version)) {
      throw new Error(`Unsupported ${kind} library version ${String(version)}; expected ${expected.join(' or ')}. Migrate a copy with browser persistence before restoring.`);
    }
  }
}

/** Report sink for Effects / master modifiers a v3 restore dropped. Defaults to the server log. */
type LibraryDiagnosticSink = (diagnostics: readonly effectChain.LibraryDiagnostic[]) => void;

const logDiagnostics: LibraryDiagnosticSink = (diagnostics) => {
  for (const d of diagnostics) {
    console.warn(`[show restore] dropped ${d.kind} ${d.id ?? `#${d.index}`} in ${d.songId}/${d.sectionId}: ${d.message}`);
  }
};

/** Restore boundary for the existing web-owned library envelope, not a second authoring model.
 * Keep unknown fields in the stored blob; project only the runtime Show through the SAME protocol
 * gate used by setShow. Unsupported/corrupt shapes fail before any live mutation; an archived
 * graph-model show library projects no Show (the engine runs empty). */
export function showFromLibraries(
  showLibrary: unknown,
  songLibrary: unknown,
  onDiagnostics: LibraryDiagnosticSink = logDiagnostics,
): voice.Show | null {
  validateLibraryVersions(showLibrary, songLibrary);
  if (showLibrary === null || versionOf(showLibrary) !== SHOWS_VERSION_EFFECTS) return null;
  return effectShowFromLibraries(showLibrary, songLibrary, onDiagnostics);
}

/** v3 (effect chains): the ONE core builder, then the same protocol gate as setShow. */
function effectShowFromLibraries(showLibrary: unknown, songLibrary: unknown, onDiagnostics: LibraryDiagnosticSink): voice.Show | null {
  // An archived graph-model song library holds no effect songs: its references resolve to
  // nothing here, as a dangling ref does.
  const songs = versionOf(songLibrary) === SONGS_VERSION_EFFECTS ? effectChain.parseSongLibraryV2(songLibrary) : null;
  const { show, diagnostics } = effectChain.buildRuntimeShow(effectChain.parseShowLibraryV3(showLibrary), songs);
  if (diagnostics.length) onDiagnostics(diagnostics);
  return show === null ? null : showSchema.parse(show);
}

export interface PersistedSelection {
  songId: string | null;
  sectionId: string | null;
}

export function selectionFromLibrary(library: unknown): PersistedSelection | undefined {
  validateLibraryVersions(library, null);
  // An archived graph-model library runs no show, so its pointer names nothing to recall.
  if (library === null || versionOf(library) !== SHOWS_VERSION_EFFECTS) return undefined;
  const data = object(object(library).data);
  const selected = object(data.shows)[String(data.activeShowId)];
  if (!selected) return undefined;
  const authored = object(object(selected).authored);
  const activeSongId = typeof authored.activeSongId === 'string' ? authored.activeSongId : null;
  const activeSectionId = authored.activeSectionId;
  if (typeof activeSectionId === 'string') return { songId: activeSongId, sectionId: activeSectionId };
  // Preserve the explicit song-only pointer. The core restore path validates that the resolved
  // song is empty; dropping it here would instead seed the first song and lose a valid selection.
  if (activeSongId !== null && activeSectionId === null) return { songId: activeSongId, sectionId: null };
  return undefined;
}
