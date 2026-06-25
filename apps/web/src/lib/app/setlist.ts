/* Setlist model — songs → sections → per-PAD GRAPH SLOTS, as a PURE module (no
   runes, no DOM) so the structure + its invariants are unit-testable in node, like
   shell-nav / show-builder. Slots are keyed per pad by padKey "drumId:zone" — the
   SAME identity `store.graphs` uses — so each zone of a drum carries its own slot
   graphs (Edge ≠ Centre). A slot holds a *reference* to a trigger graph (its key
   in the store's `graphs` map), never a copy — so the SAME graph can appear in
   many sections (reuse), and stacking a second graph in another slot LAYERS it
   (layer routing lives inside the graph's buses, so slots are graph layers, not a
   separate layer axis). The store is a thin rune holder that delegates here.

   Scope note: this is the authored ARRANGEMENT. The engine fires a section's per-pad
   slot graphs on a hit (resolved by padKey); the grid authors + organises + links to
   graph editing. */

/** A slot is a reference to a graph by key (store.graphs padKey), or empty. */
export type Slot = string | null;

/** padKey "drumId:zone" → its ordered graph slots for a section (length === SLOTS_PER_DRUM). */
export type SectionSlots = Record<string, Slot[]>;

export interface SetlistSection {
  id: string;
  name: string;
  slots: SectionSlots;
}

export interface Song {
  id: string;
  name: string;
  sections: SetlistSection[];
}

/** Up to three layerable graph slots per drum, per the wireframe (L1/L2/L3). */
export const SLOTS_PER_DRUM = 3;

export function emptySlots(padKeys: readonly string[], n = SLOTS_PER_DRUM): SectionSlots {
  const out: SectionSlots = {};
  for (const k of padKeys) out[k] = Array.from({ length: n }, () => null);
  return out;
}

export function makeSection(id: string, name: string, padKeys: readonly string[], n = SLOTS_PER_DRUM): SetlistSection {
  return { id, name, slots: emptySlots(padKeys, n) };
}

/** Slots for a pad (padKey) in a section, always padded to SLOTS_PER_DRUM. */
export function slotsFor(section: SetlistSection, padKey: string, n = SLOTS_PER_DRUM): Slot[] {
  const s = section.slots[padKey];
  if (!s) return Array.from({ length: n }, () => null);
  if (s.length === n) return s;
  return Array.from({ length: n }, (_, i) => s[i] ?? null);
}

// ---- immutable section/song edits ------------------------------------------

function mapSection(song: Song, sectionId: string, fn: (s: SetlistSection) => SetlistSection): Song {
  let changed = false;
  const sections = song.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const next = fn(s);
    if (next !== s) changed = true; // no-op edits (e.g. out-of-range) keep the ref
    return next;
  });
  return changed ? { ...song, sections } : song;
}

/** Place a graph reference into (pad, slot). Returns a new Song (immutable). */
export function setSlot(song: Song, sectionId: string, padKey: string, slotIndex: number, graphKey: string | null): Song {
  return mapSection(song, sectionId, (s) => {
    const slots = slotsFor(s, padKey).slice();
    if (slotIndex < 0 || slotIndex >= slots.length) return s;
    slots[slotIndex] = graphKey;
    return { ...s, slots: { ...s.slots, [padKey]: slots } };
  });
}

export function clearSlot(song: Song, sectionId: string, padKey: string, slotIndex: number): Song {
  return setSlot(song, sectionId, padKey, slotIndex, null);
}

export function addSection(song: Song, section: SetlistSection): Song {
  return { ...song, sections: [...song.sections, section] };
}

export function renameSection(song: Song, sectionId: string, name: string): Song {
  return mapSection(song, sectionId, (s) => ({ ...s, name }));
}

// ---- reuse / usage queries -------------------------------------------------

/** Count every (section, pad, slot) position across the song that references a graph. */
export function graphUsageCount(song: Song, graphKey: string): number {
  let n = 0;
  for (const sec of song.sections) {
    for (const slots of Object.values(sec.slots)) {
      for (const ref of slots) if (ref === graphKey) n++;
    }
  }
  return n;
}

/** A graph is "reused" when it appears in more than one slot position in the song. */
export function isReused(song: Song, graphKey: string): boolean {
  return graphUsageCount(song, graphKey) > 1;
}

/** Distinct graph keys referenced anywhere in the song (for "reused across sections"). */
export function referencedGraphs(song: Song): string[] {
  const set = new Set<string>();
  for (const sec of song.sections) {
    for (const slots of Object.values(sec.slots)) {
      for (const ref of slots) if (ref) set.add(ref);
    }
  }
  return [...set];
}

/** How many slots a pad has filled in a section (for the "+ layer" affordance). */
export function filledCount(section: SetlistSection, padKey: string): number {
  return slotsFor(section, padKey).filter(Boolean).length;
}
