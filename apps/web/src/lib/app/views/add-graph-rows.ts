/* Row model for the Add-graph modal. Pure — the dialog is thin over this.

   Two ways to read the library (Tim, 2026-09-27: "a way to sort through the trigger graphs"):
   - by ZONE (default): one group per drum zone the kit declares, in kit order, then "Other
     triggers" for MIDI / OSC / unassigned graphs and zones no longer declared. A zone with no graph
     is still listed, so it can be given one — before this, a zone only appeared once some graph
     already fired from it.
   - by NAME: one flat A–Z list.

   Inside a zone, the graphs a section plays come first, so an unused copy sinks below the graph it
   copies. Every row carries how many sections play it and whether it is an exact duplicate — the
   two facts needed to decide what to delete. */

export interface GraphPickRow {
  key: string;
  /** Display name of the graph. */
  label: string;
  /** One-line trigger-source summary ("kick · centre", "midi 36", …). */
  sub: string;
  /** The active section already lists this key — it can still be COPIED, not linked again. */
  inSection: boolean;
  /** How many section placements (across every song) play this graph. 0 = unused. */
  placements: number;
  /** Another graph has exactly the same nodes and wires. */
  duplicate: boolean;
}

export type GraphSort = 'zone' | 'name';

/** A drum zone the kit declares, with the name a graph for it gets. */
export interface ZoneRef {
  drumId: string;
  slot: number;
  title: string;
}

export interface GraphPickGroup {
  /** Stable key for the list: `zone:<drum>:<slot>`, `other`, or `all` (name sort). */
  id: string;
  /** Heading, or null for the flat name-sorted list. */
  title: string | null;
  /** The zone this group lists — set on zone groups, so an empty one can offer "Create". */
  zone: { drumId: string; slot: number } | null;
  rows: GraphPickRow[];
}

export interface GraphPickInput {
  library: ReadonlyArray<{ key: string; label: string }>;
  sectionGraphs: readonly string[];
  zones: readonly ZoneRef[];
  sub: (key: string) => string;
  /** The drum zone a graph fires from, or null for any other trigger. */
  zoneOf: (key: string) => { drumId: string; slot: number } | null;
  placements: (key: string) => number;
  duplicates: ReadonlySet<string>;
  query: string;
  sort: GraphSort;
}

const byLabel = (a: GraphPickRow, b: GraphPickRow): number =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }) || a.key.localeCompare(b.key, undefined, { numeric: true });

/** Used graphs first (most placements first), then by name — so a zone reads "the one you play,
    then its spares". */
const usedFirst = (a: GraphPickRow, b: GraphPickRow): number => b.placements - a.placements || byLabel(a, b);

export function graphPickGroups(input: GraphPickInput): GraphPickGroup[] {
  const q = input.query.trim().toLowerCase();
  const inSection = new Set(input.sectionGraphs);
  const rows: GraphPickRow[] = input.library.map((g) => ({
    key: g.key,
    label: g.label,
    sub: input.sub(g.key),
    inSection: inSection.has(g.key),
    placements: input.placements(g.key),
    duplicate: input.duplicates.has(g.key),
  }));
  const matches = (row: GraphPickRow): boolean => !q || row.label.toLowerCase().includes(q) || row.sub.toLowerCase().includes(q);

  if (input.sort === 'name') {
    return [{ id: 'all', title: null, zone: null, rows: rows.filter(matches).sort(byLabel) }];
  }

  const zoneId = (drumId: string, slot: number): string => `zone:${drumId}:${slot}`;
  const declared = new Map(input.zones.map((zone) => [zoneId(zone.drumId, zone.slot), zone]));
  const inZone = new Map<string, GraphPickRow[]>();
  const other: GraphPickRow[] = [];
  for (const row of rows) {
    const zone = input.zoneOf(row.key);
    const id = zone && zoneId(zone.drumId, zone.slot);
    if (id && declared.has(id)) inZone.set(id, [...(inZone.get(id) ?? []), row]);
    else other.push(row);
  }

  const groups: GraphPickGroup[] = [];
  for (const [id, zone] of declared) {
    // A search naming the zone keeps all of its graphs (and an empty zone its Create row).
    const titleHit = !q || zone.title.toLowerCase().includes(q);
    const listed = (inZone.get(id) ?? []).filter((row) => titleHit || matches(row)).sort(usedFirst);
    if (titleHit || listed.length > 0) groups.push({ id, title: zone.title, zone: { drumId: zone.drumId, slot: zone.slot }, rows: listed });
  }
  const others = other.filter(matches).sort(usedFirst);
  if (others.length > 0) groups.push({ id: 'other', title: 'Other triggers', zone: null, rows: others });
  return groups;
}

/** The name a copy is offered under: "<label> copy", matching `duplicateGraph`'s own labelling
    so the prompt shows what you'd get by just accepting it. */
export function copyNameFor(label: string): string {
  return `${label} copy`;
}
