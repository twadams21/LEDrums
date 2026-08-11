/* =============================================================================
   SETLIST NAVIGATION — relative song / section recall.

   "Next section" is a RELATIVE intent: it means nothing without knowing where the
   set currently is. The engine owns that (`activeSongId` / `activeSectionId`), so
   resolution has to happen against engine state, not against a server-side snapshot.

   Why that matters, concretely: the engine queues input events and drains them at
   tick. If the server resolved "next section" itself, two taps arriving inside one
   tick would both read the SAME stale active section and resolve to the same target
   — a double-tap would advance one section instead of two. Resolving here, per
   drained event, makes N taps advance N sections. Pure function of (show, where we
   are, axis, delta) → where to go.

   Ends CLAMP, they do not wrap (locked with Trent 2026-08-12): on a live set a stray
   extra tap must never teleport the rig back to song 1.
   ============================================================================= */
import type { Show } from './types';

/** Which dimension of the setlist a relative move walks. */
export type NavAxis = 'song' | 'section';

/** The song + section a navigation resolves to (the ids a `recallSection` needs). */
export interface NavTarget {
  songId: string;
  sectionId: string;
}

/**
 * Where the set currently is. Either id may be null (nothing recalled yet), in which
 * case navigation starts from the top of the setlist.
 */
export interface NavPosition {
  activeSongId: string | null;
  activeSectionId: string | null;
}

/** Clamp `i` into `[0, length)`. Returns null for an empty list (nothing to land on). */
function clampIndex(i: number, length: number): number | null {
  if (length <= 0) return null;
  return Math.max(0, Math.min(length - 1, i));
}

/**
 * Resolve a relative setlist move to the song + section it lands on.
 *
 * - `song` axis: moves by whole songs and lands on the target song's FIRST section
 *   (the same convention Program Change recall uses — you arrive at the top of a song).
 * - `section` axis: moves within the ACTIVE song only; it never spills into the next
 *   song, because "next section" at the end of a song is a clamp, not a song change.
 *
 * Returns null when there is nothing to move to: no songs, the active song has no
 * sections, or the move is already clamped against the end it is pushing into (so a
 * no-op reports as a no-op instead of re-recalling the current section, which would
 * restart its base looks).
 *
 * An unknown / null active id starts from index 0, so the first "next section" on a
 * fresh set moves 0 → 1 rather than doing nothing.
 */
export function relativeNavTarget(
  show: Show | null | undefined,
  position: NavPosition,
  axis: NavAxis,
  delta: number,
): NavTarget | null {
  const songs = show?.songs;
  if (!songs?.length) return null;

  const songIndex = Math.max(0, songs.findIndex((s) => s.id === position.activeSongId));

  if (axis === 'song') {
    const nextIndex = clampIndex(songIndex + delta, songs.length);
    if (nextIndex === null || nextIndex === songIndex) return null; // already at the end
    const song = songs[nextIndex]!;
    const section = song.sections[0];
    return section ? { songId: song.id, sectionId: section.id } : null;
  }

  const song = songs[songIndex]!;
  const sections = song.sections;
  if (!sections.length) return null;

  const sectionIndex = Math.max(0, sections.findIndex((s) => s.id === position.activeSectionId));
  const nextIndex = clampIndex(sectionIndex + delta, sections.length);
  if (nextIndex === null || nextIndex === sectionIndex) return null; // already at the end
  return { songId: song.id, sectionId: sections[nextIndex]!.id };
}
