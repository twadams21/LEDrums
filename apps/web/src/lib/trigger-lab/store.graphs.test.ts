import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab, isAuthoredGraphKey } from './store.svelte';
import type { WSClient } from '../ws/client';

/* CRUD on AUTHORED graphs — rename + delete go through real store mutators (autosave-
   consistent), the same way createGraph does. Pad graphs derive from the kit, so they
   reject both. deleteGraph also purges the graph from every section across ALL songs, so
   no section is left pointing at a graph that no longer exists. */

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

/** Run a body with a no-op rAF so start()/stop() drive the real autosave in node. */
function withRaf(body: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    body();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

describe('isAuthoredGraphKey', () => {
  it('matches authored keys (graph- / graph:) and rejects pad keys', () => {
    expect(isAuthoredGraphKey('graph-1000')).toBe(true);
    expect(isAuthoredGraphKey('graph:7')).toBe(true);
    expect(isAuthoredGraphKey('kick:0')).toBe(false);
    expect(isAuthoredGraphKey('snare:1')).toBe(false);
  });
});

describe('renameGraph (authored only)', () => {
  it('relabels an authored graph (graphNames + graphLabel)', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Original');
    store.renameGraph(key, 'My Graph');
    expect(store.graphNames[key]).toBe('My Graph');
    expect(store.graphLabel(key)).toBe('My Graph');
  });

  it('keeps the existing label on a blank name (no clear)', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Keep Me');
    store.renameGraph(key, '   ');
    expect(store.graphNames[key]).toBe('Keep Me');
  });

  it('no-ops on a pad graph (kit-derived — never enters graphNames)', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.graphLabel('kick:0');
    store.renameGraph('kick:0', 'Nope');
    expect('kick:0' in store.graphNames).toBe(false);
    expect(store.graphLabel('kick:0')).toBe(before); // still the kit label
  });

  it('no-ops on an unknown authored key (no phantom graphNames entry)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameGraph('graph-999999', 'Ghost');
    expect('graph-999999' in store.graphNames).toBe(false);
  });
});

describe('deleteGraph (authored only)', () => {
  it('removes the graph from graphs + graphNames + graphLibrary', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Doomed');
    expect(store.graphs[key]).toBeDefined();
    expect(store.graphNames[key]).toBeDefined();

    store.deleteGraph(key);
    expect(store.graphs[key]).toBeUndefined();
    expect(key in store.graphNames).toBe(false);
    expect(store.graphLibrary.some((g) => g.key === key)).toBe(false);
  });

  it('purges the key from every section across ALL songs (no dangling refs)', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Shared');

    const songAId = store.activeSongId;
    const secA = store.activeSong!.sections[0]!.id;
    store.addGraphToSection(secA, key);

    const songBId = store.createSong('Song B'); // becomes active
    const secB = store.activeSong!.sections[0]!.id;
    store.addGraphToSection(secB, key);

    // sanity: referenced in both songs before the delete
    expect(store.songs.find((s) => s.id === songAId)!.sections[0]!.graphs).toContain(key);
    expect(store.songs.find((s) => s.id === songBId)!.sections[0]!.graphs).toContain(key);

    store.deleteGraph(key);
    for (const song of store.songs) for (const sec of song.sections) expect(sec.graphs).not.toContain(key);
  });

  it('clears selectedPadKey when the deleted graph was the open one', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Open'); // createGraph selects it
    expect(store.selectedPadKey).toBe(key);
    store.deleteGraph(key);
    expect(store.selectedPadKey).toBeNull();
  });

  it('leaves the selection alone when a DIFFERENT graph is open', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.createGraph('A');
    const b = store.createGraph('B'); // now selected
    expect(store.selectedPadKey).toBe(b);
    store.deleteGraph(a);
    expect(store.selectedPadKey).toBe(b);
  });

  it('no-ops on a pad graph (stays in graphs + its seeded sections)', () => {
    const store = new TriggerLab(fakeClient);
    const sectionsWithKick = store.activeSong!.sections.filter((s) => s.graphs.includes('kick:0')).length;
    store.deleteGraph('kick:0');
    expect(store.graphs['kick:0']).toBeDefined();
    expect(store.activeSong!.sections.filter((s) => s.graphs.includes('kick:0')).length).toBe(sectionsWithKick);
  });
});

describe('persistence (autosave → hydrate)', () => {
  it('persists a rename + a delete across a reload', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      const keeper = store.createGraph('Keeper');
      store.renameGraph(keeper, 'Renamed');
      const doomed = store.createGraph('Doomed');
      const sec = store.activeSong!.sections[0]!.id;
      store.addGraphToSection(sec, doomed);
      store.deleteGraph(doomed);
      store.stop(); // flush authored slice → localStorage

      const reloaded = new TriggerLab(fakeClient); // a "reload" hydrates from storage
      expect(reloaded.graphNames[keeper]).toBe('Renamed');
      expect(reloaded.graphs[doomed]).toBeUndefined();
      expect(doomed in reloaded.graphNames).toBe(false);
      for (const song of reloaded.songs) for (const s of song.sections) expect(s.graphs).not.toContain(doomed);
    });
  });
});
