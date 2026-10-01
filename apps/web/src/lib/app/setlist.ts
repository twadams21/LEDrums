/* Setlist model — songs → sections, as a PURE module (no runes, no DOM) so the structure and its
   invariants are unit-testable in node, like shell-nav / show-builder. A section carries its
   Effect stack (composition order), its Master chain and optional timing (effect chains, S05);
   the store is a thin rune holder that delegates here. */

import type { effectChain } from '@ledrums/core';

/** One section in a song's arrangement: its Effect stack in composition order, its Master chain
    and its optional timing. */
export interface SetlistSection {
  id: string;
  name: string;
  effects: effectChain.Effect[];
  master: effectChain.ModifierDevice[];
  /** Cells that play their stack one Effect per hit (Sequence / Random) and their resets. */
  cellPlay?: effectChain.CellPlay[];
  bars?: number;
  bpm?: number;
}

export interface Song {
  id: string;
  name: string;
  sections: SetlistSection[];
}

/** A fresh, empty section (no Effects, an empty Master chain). */
export function makeSection(id: string, name: string): SetlistSection {
  return { id, name, effects: [], master: [] };
}

/** A fresh song. Defaults to ONE empty section (id derived from the song id so it is
    pure + collision-free) — a brand-new song the performer can immediately arrange,
    mirroring how a seeded song is always a non-empty list of sections. Pass an explicit
    `sections` to wrap existing ones (e.g. a duplicate's cloned sections). Mirrors
    {@link makeSection}: a pure constructor, no id generation of its own. */
export function makeSong(
  id: string,
  name: string,
  sections: SetlistSection[] = [makeSection(`${id}-s1`, 'Section 1')],
): Song {
  return { id, name, sections: sanitizeUniqueSectionIds([{ id, name, sections }])[0]?.sections ?? [] };
}

/**
 * Keep section ids globally unique across a resolved song list. Persistence and import callers
 * use this at their trust boundaries; the first valid section wins so malformed data is repaired
 * deterministically without changing the order of surviving content.
 */
export function sanitizeUniqueSectionIds(songs: readonly Song[], reserved = new Set<string>()): Song[] {
  return songs.map((song) => {
    let changed = false;
    const sections = song.sections.filter((section) => {
      if (!section.id || reserved.has(section.id)) {
        changed = true;
        return false;
      }
      reserved.add(section.id);
      return true;
    });
    return changed ? { ...song, sections } : song;
  });
}

// ---- immutable section/song edits ------------------------------------------

function mapSection(song: Song, sectionId: string, fn: (s: SetlistSection) => SetlistSection): Song {
  let changed = false;
  const sections = song.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const next = fn(s);
    if (next === s) return s; // no-op edits keep the ref
    changed = true;
    return next;
  });
  return changed ? { ...song, sections } : song;
}

export function addSection(song: Song, section: SetlistSection): Song {
  return { ...song, sections: [...song.sections, section] };
}

/** A drop index is expressed in the pre-removal list. When moving an item downward inside the
    same list, removal shifts every later index left by one, so insert before `toIndex - 1`.
    Without this, dragging B onto C in [A,B,C] incorrectly became [A,C,B]. */
function sameListInsertIndex(fromIndex: number, toIndex: number, maxAfterRemoval: number): number {
  return clampIndex(toIndex > fromIndex ? toIndex - 1 : toIndex, maxAfterRemoval);
}

/** Reorder a section by id, inserting it before the section at `toIndex` after removal.
    Dragging a section onto itself is a no-op. Out-of-range targets clamp to the song ends. */
export function moveSection(song: Song, sectionId: string, toIndex: number): Song {
  const fromIndex = song.sections.findIndex((s) => s.id === sectionId);
  if (fromIndex < 0) return song;
  const sections = [...song.sections];
  const [section] = sections.splice(fromIndex, 1);
  if (!section) return song;
  const insertAt = sameListInsertIndex(fromIndex, toIndex, sections.length);
  if (insertAt === fromIndex) return song;
  sections.splice(insertAt, 0, section);
  return { ...song, sections };
}

/** Drop a section from the song (mirror of {@link addSection}). Immutable; the remaining
    sections keep their order. No-op — returns the SAME Song ref — when the id is absent. */
export function removeSection(song: Song, sectionId: string): Song {
  if (!song.sections.some((s) => s.id === sectionId)) return song;
  return { ...song, sections: song.sections.filter((s) => s.id !== sectionId) };
}

/** Copy a section under a NEW id (name defaults to "<name> copy"). The Effect stack and Master
    chain are deep-copied, so the clone never aliases its source. */
export function cloneSection(section: SetlistSection, newId: string, newName?: string): SetlistSection {
  const out: SetlistSection = {
    id: newId,
    name: newName ?? `${section.name} copy`,
    effects: JSON.parse(JSON.stringify(section.effects)) as effectChain.Effect[],
    master: JSON.parse(JSON.stringify(section.master)) as effectChain.ModifierDevice[],
  };
  if (section.bars !== undefined) out.bars = section.bars;
  if (section.bpm !== undefined) out.bpm = section.bpm;
  return out;
}

export function renameSection(song: Song, sectionId: string, name: string): Song {
  return mapSection(song, sectionId, (s) => ({ ...s, name }));
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return max;
  return Math.max(0, Math.min(Math.trunc(index), max));
}
