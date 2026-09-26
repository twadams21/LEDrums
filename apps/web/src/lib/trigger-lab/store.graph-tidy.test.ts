import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* The store half of the Add-graph tidy-up (Tim, 2026-09-27): the declared drum zones the list
   groups under, creating a graph for a zone that has none, and removing exact duplicates no
   section plays. */

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('drumZones', () => {
  it('lists every zone the input map declares, in kit order then slot order', () => {
    const store = setup();
    const drums = store.project!.kit.drums.map((d) => d.id);
    const zones = store.drumZones;
    expect(zones.length).toBeGreaterThan(0);
    const order = zones.map((z) => [drums.indexOf(z.drumId), z.slot]);
    expect(order).toEqual([...order].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
    expect(zones[0]!.title).toContain('·');
  });

  it('is empty offline, with no input map', () => {
    expect(new TriggerLab(fakeClient).drumZones).toEqual([]);
  });
});

describe('createZoneGraphInSection', () => {
  it('creates a graph that fires from the zone, named after it, placed in the section — one undo', () => {
    const store = setup();
    const zone = store.drumZones.at(-1)!;
    const sectionId = store.activeSectionId!;
    const before = [...store.activeSection!.graphs];

    const key = store.createZoneGraphInSection(sectionId, zone.drumId, zone.slot)!;

    expect(store.triggerSource(key)).toEqual({ kind: 'drum', drumId: zone.drumId, zone: String(zone.slot) });
    expect(store.graphLabel(key)).toBe(zone.title);
    expect(store.activeSection!.graphs).toEqual([...before, key]);
    store.undo();
    expect(store.graphs[key]).toBeUndefined();
    expect(store.activeSection!.graphs).toEqual(before);
  });
});

describe('removeDuplicateGraphs', () => {
  it('deletes the unused exact copies, keeps the used one — one undo', () => {
    const store = setup();
    const sectionId = store.activeSectionId!;
    const placed = store.activeSection!.graphs[0]!;
    const spareA = store.copyGraphToSection(sectionId, placed, 'Spare A')!;
    const spareB = store.copyGraphToSection(sectionId, placed, 'Spare B')!;
    store.removeGraphFromSection(sectionId, spareA);
    store.removeGraphFromSection(sectionId, spareB);

    expect(store.duplicateGraphKeys.has(spareA)).toBe(true);
    expect(store.redundantDuplicateGraphs).toEqual(expect.arrayContaining([spareA, spareB]));
    expect(store.redundantDuplicateGraphs).not.toContain(placed);

    const removed = store.removeDuplicateGraphs();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(store.graphs[spareA]).toBeUndefined();
    expect(store.graphs[spareB]).toBeUndefined();
    expect(store.graphs[placed]).toBeDefined();
    expect(store.redundantDuplicateGraphs).toEqual([]);

    store.undo();
    expect(store.graphs[spareA]).toBeDefined();
    expect(store.graphs[spareB]).toBeDefined();
  });

  it('never deletes a copy a section plays', () => {
    const store = setup();
    const sectionId = store.activeSectionId!;
    const placed = store.activeSection!.graphs[0]!;
    const twin = store.copyGraphToSection(sectionId, placed, 'Twin')!; // stays placed
    store.removeDuplicateGraphs();
    expect(store.graphs[placed]).toBeDefined();
    expect(store.graphs[twin]).toBeDefined();
  });
});
