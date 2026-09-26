import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { templateAuthored } from './store/templates';
import { deserializeAuthored, serializeAuthored } from './persistence';
import type { WSClient } from '../ws/client';

/* Zone-template shows (Tim, 2026-09-27): a new show can start from the kit's declared drum zones,
   and a show with the setting on gives every NEW section and song one empty graph per zone — so
   the zones are always there in the Trigger and Sections views without being rebuilt. Duplicating
   a section still copies it as it is. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

function setup(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.project = defaultProject();
  return store;
}

/** The zones (as "drum:slot") the section's graphs fire from, in order. */
function zonesOf(store: TriggerLab, graphKeys: readonly string[]): string[] {
  return graphKeys.map((key) => {
    const source = store.triggerSource(key);
    return source?.kind === 'drum' ? `${source.drumId}:${source.zone}` : '?';
  });
}
const declared = (store: TriggerLab): string[] => store.drumZones.map((zone) => `${zone.drumId}:${zone.slot}`);

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('templateAuthored', () => {
  const zones = [
    { drumId: 'kick', slot: 0, title: 'Kick · center' },
    { drumId: 'snare', slot: 2, title: 'Snare · rim' },
  ];

  it('blank: one song, one empty section, no graphs, setting off — no demo pads', () => {
    const a = templateAuthored('blank', zones);
    expect(a.graphs).toEqual({});
    expect(a.songs).toHaveLength(1);
    expect(a.songs[0]!.sections).toEqual([expect.objectContaining({ name: 'Section 1', graphs: [] })]);
    expect(a.activeSectionId).toBe(a.songs[0]!.sections[0]!.id);
    expect(a.autoZoneGraphs).toBe(false);
  });

  it('zones: one empty graph per zone, named for it, all in the first section, setting on', () => {
    const a = templateAuthored('zones', zones);
    const keys = a.songs[0]!.sections[0]!.graphs;
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => a.graphNames[k])).toEqual(['Kick · center', 'Snare · rim']);
    expect(keys.map((k) => a.graphs[k]!.nodes.find((n) => n.kind === 'trigger')!.source)).toEqual([
      { kind: 'drum', drumId: 'kick', zone: '0' },
      { kind: 'drum', drumId: 'snare', zone: '2' },
    ]);
    expect(keys.every((k) => a.graphs[k]!.nodes.length === 2)).toBe(true); // trigger + output
    expect(a.selectedPadKey).toBe(keys[0]);
    expect(a.autoZoneGraphs).toBe(true);
  });

  it('the setting survives a save and load', () => {
    const back = deserializeAuthored(JSON.parse(JSON.stringify(serializeAuthored(templateAuthored('zones', zones)))));
    expect(back?.autoZoneGraphs).toBe(true);
  });
});

describe('newShow from a template', () => {
  it('From my trigger zones: the active section holds a graph for every declared zone', () => {
    const store = setup();
    store.newShow('Gig', 'zones');
    expect(store.activeShow?.name).toBe('Gig');
    expect(zonesOf(store, store.activeSection!.graphs)).toEqual(declared(store));
    expect(store.autoZoneGraphs).toBe(true);
  });

  it('Blank: an empty section and the setting off', () => {
    const store = setup();
    store.newShow('Empty', 'blank');
    expect(store.activeSection!.graphs).toEqual([]);
    expect(store.autoZoneGraphs).toBe(false);
  });

  it('switching to a show that never set it turns it off', () => {
    const store = setup();
    const plain = store.newShow('Plain', 'blank');
    store.newShow('Zones', 'zones');
    store.openShow(plain);
    expect(store.autoZoneGraphs).toBe(false);
  });
});

describe('new sections and songs in a zone show', () => {
  it('a new section gets its own graph per zone; one undo removes section and graphs', () => {
    const store = setup();
    store.newShow('Gig', 'zones');
    const first = new Set(store.activeSection!.graphs);
    const sectionCount = store.activeSong!.sections.length;
    const graphCount = Object.keys(store.graphs).length;

    store.addSongSection('Chorus');

    const added = store.activeSection!;
    expect(added.name).toBe('Chorus');
    expect(zonesOf(store, added.graphs)).toEqual(declared(store));
    expect(added.graphs.some((key) => first.has(key))).toBe(false); // independent, not linked

    store.undo();
    expect(store.activeSong!.sections).toHaveLength(sectionCount);
    expect(Object.keys(store.graphs)).toHaveLength(graphCount);
  });

  it('a new song’s first section gets them too', () => {
    const store = setup();
    store.newShow('Gig', 'zones');
    store.createSong('Encore');
    expect(store.activeSong!.name).toBe('Encore');
    expect(zonesOf(store, store.activeSection!.graphs)).toEqual(declared(store));
  });

  it('with the setting off, a new section stays empty', () => {
    const store = setup();
    store.newShow('Plain', 'blank');
    store.addSongSection('Verse');
    expect(store.activeSection!.graphs).toEqual([]);
  });

  it('duplicating a section copies it as it is — no extra zone graphs', () => {
    const store = setup();
    store.newShow('Gig', 'zones');
    const source = store.activeSection!;
    store.duplicateSection(source.id);
    const copy = store.activeSong!.sections.find((s) => s.id !== source.id)!;
    expect(copy.graphs).toHaveLength(source.graphs.length);
  });
});

describe('Settings: the switch and "Add to existing sections"', () => {
  it('turning it on makes the next new section a zone section — undoable', () => {
    const store = setup();
    store.newShow('Plain', 'blank');
    store.setAutoZoneGraphs(true);
    store.addSongSection('Verse');
    expect(zonesOf(store, store.activeSection!.graphs)).toEqual(declared(store));
    store.undo(); // the section
    store.undo(); // the switch
    expect(store.autoZoneGraphs).toBe(false);
  });

  it('fills only the zones each existing section lacks, as one undo step', () => {
    const store = setup();
    store.newShow('Plain', 'blank');
    store.addSongSection('Verse');
    const partial = store.activeSection!.id;
    const zone = store.drumZones[0]!;
    store.createZoneGraphInSection(partial, zone.drumId, zone.slot);

    const added = store.fillAllSectionsWithZoneGraphs();

    const sections = store.activeSong!.sections;
    expect(added).toBe(declared(store).length * sections.length - 1);
    for (const section of sections) expect(zonesOf(store, section.graphs).sort()).toEqual([...declared(store)].sort());
    expect(store.fillAllSectionsWithZoneGraphs()).toBe(0);

    store.undo();
    expect(store.activeSong!.sections.find((s) => s.id === partial)!.graphs).toHaveLength(1);
  });
});
