/* Setlist model — songs → sections → a FLAT ORDERED LIST OF GRAPHS, as a PURE module
   (no runes, no DOM) so the structure + its invariants are unit-testable in node, like
   shell-nav / show-builder. A section is `{ id, name, graphs }` where `graphs` is an
   ordered list of graph KEYS into the store's `graphs` map — a *reference*, never a copy,
   so the SAME graph can appear in many sections (reuse). The store is a thin rune holder
   that delegates here.

   Resolution (in the store + sim): a hit fires the ACTIVE section's graphs whose trigger
   `source` matches the input — so each zone still fires only its own graph, and LAYERING
   is two graphs in the section that share a source (layer routing lives inside each
   graph's buses). This drops the old per-pad 3-layer slot grid (`SectionSlots`/`Slot`,
   keyed by padKey) entirely; the back-compat migration that flattens a persisted section's
   `slots` into this `graphs` list lives in `persistence.ts`. */

/** One section in a song's arrangement: an ordered list of graph keys (into store.graphs)
    plus its per-bus "looks" — which effect each bus LOOPS while the section is active (the
    base/trigger/effect ambience the engine spawns on recall). The graph list is de-duplicated
    (a graph appears at most once per section); `looks` is keyed by bus id, a value of `null`
    (or an absent key) meaning that bus loops nothing. Looks are AUTHORED here (S16) — the
    single source of truth the show-builder bridges to the engine's `Section.looks`. */
export interface SetlistSection {
  id: string;
  name: string;
  graphs: string[];
  looks: Record<string, string | null>;
}

export interface Song {
  id: string;
  name: string;
  sections: SetlistSection[];
}

/** A section seeded with an (optional) ordered graph-key list (de-duplicated) and an
    (optional) per-bus looks map (copied, so the section owns it). Both default to empty —
    a brand-new section references no graphs and loops no looks. */
export function makeSection(
  id: string,
  name: string,
  graphs: readonly string[] = [],
  looks: Readonly<Record<string, string | null>> = {},
): SetlistSection {
  return { id, name, graphs: dedupe(graphs), looks: { ...looks } };
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
  return { id, name, sections };
}

// ---- immutable section/song edits ------------------------------------------

function mapSection(song: Song, sectionId: string, fn: (s: SetlistSection) => SetlistSection): Song {
  let changed = false;
  const sections = song.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const next = fn(s);
    if (next !== s) changed = true; // no-op edits (e.g. duplicate add) keep the ref
    return next;
  });
  return changed ? { ...song, sections } : song;
}

/** Append a graph reference to a section. Idempotent — a key already in the section is a
    no-op (returns the same Song ref), keeping the list a set-like ordered list. */
export function addGraph(song: Song, sectionId: string, graphKey: string): Song {
  return mapSection(song, sectionId, (s) =>
    s.graphs.includes(graphKey) ? s : { ...s, graphs: [...s.graphs, graphKey] },
  );
}

/** Remove a graph reference from a section (no-op if absent). */
export function removeGraph(song: Song, sectionId: string, graphKey: string): Song {
  return mapSection(song, sectionId, (s) =>
    s.graphs.includes(graphKey) ? { ...s, graphs: s.graphs.filter((k) => k !== graphKey) } : s,
  );
}

/** Replace a section's whole graph list (de-duplicated, order preserved) — for reorder. */
export function setGraphs(song: Song, sectionId: string, graphs: readonly string[]): Song {
  return mapSection(song, sectionId, (s) => ({ ...s, graphs: dedupe(graphs) }));
}

/** Set (or clear) the effect a section loops on a bus — its "look". `effectId` `null` = None
    (the bus loops nothing). Immutable + idempotent: setting the value a bus already carries
    (treating an absent key as `null`) returns the SAME Song ref, so a no-op re-pick doesn't
    churn autosave/resync. Mirrors {@link setGraphs} — a per-section attribute edit. */
export function setLook(song: Song, sectionId: string, busId: string, effectId: string | null): Song {
  return mapSection(song, sectionId, (s) =>
    (s.looks[busId] ?? null) === effectId ? s : { ...s, looks: { ...s.looks, [busId]: effectId } },
  );
}

export function addSection(song: Song, section: SetlistSection): Song {
  return { ...song, sections: [...song.sections, section] };
}

/** Drop a section from the song (mirror of {@link addSection}). Immutable; the remaining
    sections keep their order. No-op — returns the SAME Song ref — when the id is absent. */
export function removeSection(song: Song, sectionId: string): Song {
  if (!song.sections.some((s) => s.id === sectionId)) return song;
  return { ...song, sections: song.sections.filter((s) => s.id !== sectionId) };
}

/** Deep-copy a section under a NEW id (name defaults to "<name> copy"). The `graphs` list is
    copied so the clone is an INDEPENDENT section — editing one section's list never touches
    the other. The keys themselves stay references into store.graphs, so the copy shares the
    SAME underlying graphs (reuse); only the section's ordered key list is duplicated, never
    the graphs. Backs the section copy/paste in the store. */
export function cloneSection(section: SetlistSection, newId: string, newName?: string): SetlistSection {
  return { id: newId, name: newName ?? `${section.name} copy`, graphs: [...section.graphs], looks: { ...section.looks } };
}

export function renameSection(song: Song, sectionId: string, name: string): Song {
  return mapSection(song, sectionId, (s) => ({ ...s, name }));
}

// ---- reuse / usage queries -------------------------------------------------

/** How many sections across the song reference a graph (each section counts once — the
    flat list is de-duplicated per section). */
export function graphUsageCount(song: Song, graphKey: string): number {
  let n = 0;
  for (const sec of song.sections) if (sec.graphs.includes(graphKey)) n++;
  return n;
}

/** A graph is "reused" when it appears in more than one section. */
export function isReused(song: Song, graphKey: string): boolean {
  return graphUsageCount(song, graphKey) > 1;
}

/** Distinct graph keys referenced anywhere in the song, in first-appearance order. */
export function referencedGraphs(song: Song): string[] {
  const set = new Set<string>();
  for (const sec of song.sections) for (const k of sec.graphs) set.add(k);
  return [...set];
}

/** De-duplicate a key list, preserving first-appearance order. */
function dedupe(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
