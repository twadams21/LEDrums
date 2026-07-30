import { TRIGGER_SLOT_COUNT, type InputMap, type voice } from '@ledrums/core';
import type { OscEvent } from '@ledrums/io';

/**
 * A raw hardware input, time-stamped — a MIDI note or an OSC address/value.
 *
 * This was exported from `@ledrums/core` (declared in the legacy engine, which consumed it as its
 * queue element). INIT-01 S13 deleted that engine, and this file is now both the only producer
 * ({@link midiToEvent} / {@link oscToEvent}) and the only consumer, so the type lives where it is
 * used rather than on a package boundary nothing else crosses. NOT to be confused with
 * `voice.InputEvent`, the voice engine's richer pad/graph-aware event.
 */
export type InputEvent =
  | { kind: 'noteOn'; note: number; velocity: number; timeMs: number }
  | { kind: 'noteOff'; note: number; timeMs: number }
  | { kind: 'osc'; address: string; value: number; timeMs: number };

/** A drum-zone pad resolved from the patch zone-map (the pad-bound graph it fires). */
export interface ZonePad {
  drumId: string;
  zone: string;
}

/**
 * Map a trigger slot index to its padKey zone form — the slot index AS A STRING (clamped).
 *
 * This is the zone identity the authored model uses everywhere: graphs are keyed
 * `padKey(drumId, String(slot))` (`"snare:0"`), a `drum` trigger source carries the same
 * numeric-string zone, and the web sends `zone: String(pad.zone)` on a `key` message.
 * Emitting a LABEL here instead (`"snare:center"`) meant a MIDI- or OSC-resolved pad could
 * never match an authored graph — every hit missed with `no-slot-graphs` while the web's own
 * pad clicks worked, because only this path converted. {@link SLOT_LABELS} is a DISPLAY
 * concern (see `describeVoiceInput`), never an identity.
 */
function slotToZone(slot: number): string {
  return String(Math.max(0, Math.min(TRIGGER_SLOT_COUNT - 1, slot)));
}

/**
 * Zone-map resolution — PINNED precedence STEP 1. Resolve a raw MIDI note to its
 * `(drumId, zone)` pad via the patch {@link InputMap} (`midiNotes`, keyed `(drumId,
 * slot)` → numeric-string zone). A match fires the pad-bound graph (the padKey path) and the
 * caller STOPS; a miss (`null`) means the caller forwards the raw note so the engine can
 * fire a graph bound DIRECTLY to it by its trigger source (step 2) — never both.
 */
export function zoneForNote(inputMap: InputMap, note: number): ZonePad | null {
  const m = inputMap.midiNotes.find((x) => x.note === note);
  return m ? { drumId: m.drumId, zone: slotToZone(m.slot) } : null;
}

/** Zone-map resolution (step 1) for OSC: resolve an address to its `(drumId, zone)` pad
    via the patch {@link InputMap} `oscMap`, else `null` (forward raw for direct binding). */
export function zoneForOsc(inputMap: InputMap, address: string): ZonePad | null {
  const m = inputMap.oscMap.find((x) => x.address === address);
  return m ? { drumId: m.drumId, zone: slotToZone(m.slot) } : null;
}

/** Convert a WS MIDI message into a time-stamped engine event (velocity 0..127 → 0..1). */
export function midiToEvent(note: number, velocity: number, on: boolean, timeMs: number): InputEvent {
  if (on && velocity > 0) return { kind: 'noteOn', note, velocity: velocity / 127, timeMs };
  return { kind: 'noteOff', note, timeMs };
}

/** Convert an inbound OSC event into an engine event (first numeric arg as value). */
export function oscToEvent(e: OscEvent, timeMs: number): InputEvent | null {
  const first = e.args.find((a) => typeof a === 'number');
  return { kind: 'osc', address: e.address, value: typeof first === 'number' ? first : 1, timeMs };
}

// ---------------------------------------------------------------------------
// Global transport recall (PINNED precedence STEP 0 — runs BEFORE the zone-map)
// ---------------------------------------------------------------------------
//
// A DAW/controller drives the set via GLOBAL conventions, not per-section bindings:
//   • Program Change value n   → select song n in the active setlist, recall its first section
//   • CC #0 value v            → recall section v in the ACTIVE song
//   • OSC /ledrums/song_<n>/section  (arg = section index) → select song n + that section
// Each maps an index → the song/section ids in the live Show and reuses the engine's
// existing `recallSection` input. Out-of-range indices are NO-OPS (return null). These
// helpers are PURE (Show in → ids out) so they unit-test without the engine; the server
// wires them at the input boundary before per-trigger resolution.

/** Controller number reserved for global section recall — no trigger may bind it. */
export const SECTION_RECALL_CC = 0;

/** The song + section ids a transport-recall resolves to. */
export interface RecallTarget {
  songId: string;
  sectionId: string;
}

/**
 * OSC section-recall address: `/ledrums/song_<n>/section`, where `<n>` is the setlist
 * song index and the OSC argument carries the section index. Kept byte-identical to the
 * web's `oscForSection` display helper (apps/web/src/lib/app/recall.ts).
 */
const SECTION_RECALL_ADDR = /^\/ledrums\/song_(\d+)\/section$/;

/** The song index encoded in a section-recall OSC address, or null if it isn't one. */
export function parseSectionRecallAddress(address: string): number | null {
  const m = SECTION_RECALL_ADDR.exec(address);
  return m ? Number(m[1]) : null;
}

/** Resolve a song + section by their setlist indices (no-op → null if out of range). */
function targetForIndices(show: voice.Show | null | undefined, songIndex: number, sectionIndex: number): RecallTarget | null {
  const song = show?.songs?.[songIndex];
  const section = song?.sections[sectionIndex];
  return song && section ? { songId: song.id, sectionId: section.id } : null;
}

/** Program Change → recall song `program`'s FIRST section (no-op if out of range). */
export function programChangeRecall(show: voice.Show | null | undefined, program: number): RecallTarget | null {
  return targetForIndices(show, program, 0);
}

/**
 * CC #0 value → recall section `index` in the ACTIVE song (the last song recalled, or
 * the first song when none has been recalled yet). No-op if out of range.
 */
export function sectionIndexRecall(
  show: voice.Show | null | undefined,
  activeSongId: string | null,
  index: number,
): RecallTarget | null {
  const songs = show?.songs;
  if (!songs?.length) return null;
  const song = songs.find((s) => s.id === activeSongId) ?? songs[0]!;
  const section = song.sections[index];
  return section ? { songId: song.id, sectionId: section.id } : null;
}

/**
 * OSC `/ledrums/song_<n>/section` + value → recall song n / section value. Returns null
 * when the address isn't a section-recall address OR the indices are out of range (so the
 * caller falls through to the normal zone-map / direct-binding OSC path).
 */
export function oscRecall(show: voice.Show | null | undefined, address: string, value: number): RecallTarget | null {
  const songIndex = parseSectionRecallAddress(address);
  if (songIndex === null) return null;
  return targetForIndices(show, songIndex, Math.floor(value));
}
