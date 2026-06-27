// Global transport-recall conventions, as human-readable strings + the reserved-controller
// guard. Pure + dependency-free so the section Inspector (and the trigger-source editor)
// can consume them without touching the engine. The OSC string here is byte-identical to
// what the server parses (apps/server/src/input-router.ts SECTION_RECALL_ADDR) — the two
// must never drift, so both are pinned by tests.
//
// Indices are 0-based, matching the on-the-wire MIDI Program Change / CC values and the
// setlist array order the server resolves against.

/** Controller 0 is reserved for global section recall — no trigger may bind it. */
export const RESERVED_CC = 0;

/** Whether a controller number is the reserved section-recall controller. */
export function isReservedCc(cc: number): boolean {
  return cc === RESERVED_CC;
}

/**
 * The OSC message that recalls song `songIdx` / section `sectionIdx`: the address
 * `/ledrums/song_<n>/section` joined to its section-index argument, e.g.
 * `/ledrums/song_0/section 2`. The server parses the address; the argument is the section.
 */
export function oscForSection(songIdx: number, sectionIdx: number): string {
  return `/ledrums/song_${songIdx}/section ${sectionIdx}`;
}

/** The MIDI message that selects song `songIdx`: a Program Change at that index. */
export function midiForSong(songIdx: number): string {
  return `Program Change ${songIdx}`;
}

/** The MIDI message that recalls section `sectionIdx` in the active song: CC #0. */
export function midiForSection(sectionIdx: number): string {
  return `CC 0 value ${sectionIdx}`;
}
