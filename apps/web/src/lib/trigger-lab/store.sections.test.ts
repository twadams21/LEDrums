import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* U4 — sections as flat graph lists, the merged active section, and hit-resolution off the
   active section's source-matched graphs. The store seeds one song whose sections each hold
   EVERY pad's graph key; each pad graph carries a `drum` source from its padKey (hydrate),
   so a hit fires only the matching pad's graph — the pre-section per-zone behaviour, now
   expressed as a flat list + source filter. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

const kickCentre = (store: TriggerLab) => store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!;

describe('seed: sections are flat graph lists of every pad', () => {
  it('every section lists every pad graph key (and defaults the first section active)', () => {
    const store = new TriggerLab(fakeClient);
    const padKeys = store.pads.map((p) => `${p.drumId}:${p.zone}`);
    expect(store.activeSong!.sections.length).toBeGreaterThan(0);
    for (const sec of store.activeSong!.sections) expect(sec.graphs).toEqual(padKeys);
    expect(store.activeSectionId).toBe(store.activeSong!.sections[0]!.id);
    expect(store.activeSection?.id).toBe(store.activeSectionId);
  });
});

describe('setActiveSection / selectGraphInSection (merged active+arrange)', () => {
  it('setActiveSection sets the active section id', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.activeSong!.sections[1]!.id;
    store.setActiveSection(id);
    expect(store.activeSectionId).toBe(id);
  });

  it('selectGraphInSection activates the section AND opens the graph (highlight)', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.activeSong!.sections[1]!.id;
    const key = store.activeSong!.sections[1]!.graphs[0]!;
    store.selectGraphInSection(id, key);
    expect(store.activeSectionId).toBe(id); // section made active
    expect(store.selectedPadKey).toBe(key); // graph opened in the canvas
  });

  it('selectGraphInSection ignores an unknown graph key but still activates the section', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.activeSong!.sections[1]!.id;
    store.selectGraphInSection(id, 'no-such-graph');
    expect(store.activeSectionId).toBe(id);
    expect(store.selectedPadKey).not.toBe('no-such-graph');
  });
});

describe('section graph-list mutators', () => {
  it('addGraphToSection appends (idempotent) + removeGraphFromSection removes', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Authored'); // an authored graph, not yet in any section
    const id = store.activeSong!.sections[0]!.id;
    store.addGraphToSection(id, key);
    expect(store.activeSong!.sections[0]!.graphs).toContain(key);
    store.addGraphToSection(id, key); // idempotent — no duplicate
    expect(store.activeSong!.sections[0]!.graphs.filter((k) => k === key)).toHaveLength(1);
    store.removeGraphFromSection(id, key);
    expect(store.activeSong!.sections[0]!.graphs).not.toContain(key);
  });
});

describe('hit resolution = active section graphs whose drum source matches the pad', () => {
  it('fires only the matching pad graph (each zone fires its own)', () => {
    const store = new TriggerLab(fakeClient);
    store.hit(kickCentre(store));
    expect(store.log).toHaveLength(1); // exactly one graph fired
    expect(store.log[0]!.pad).toBe(store.graphLabel('kick:0'));
  });

  it('fires nothing when the active section has no graph matching the pad', () => {
    const store = new TriggerLab(fakeClient);
    store.removeGraphFromSection(store.activeSectionId!, 'kick:0');
    store.hit(kickCentre(store));
    expect(store.log).toHaveLength(0); // the section gates resolution — no fallback while active
  });

  it('layers two section graphs that share a source (both fire on the hit)', () => {
    const store = new TriggerLab(fakeClient);
    // an authored graph bound to the SAME drum source as kick:0 → layered onto kick centre
    const layer = store.createGraph('Kick layer');
    store.setTriggerSource(layer, { kind: 'drum', drumId: 'kick', zone: '0' });
    store.addGraphToSection(store.activeSectionId!, layer);
    store.hit(kickCentre(store));
    expect(store.log).toHaveLength(2); // kick:0 + the layered graph
    expect(store.log.map((l) => l.pad)).toEqual(
      expect.arrayContaining([store.graphLabel('kick:0'), 'Kick layer']),
    );
  });

  it('falls back to the pad’s own graph when there is NO active section (pre-section behaviour)', () => {
    const store = new TriggerLab(fakeClient);
    store.activeSectionId = null;
    store.hit(kickCentre(store));
    expect(store.log).toHaveLength(1);
    expect(store.log[0]!.pad).toBe('Kick · center');
  });
});
