import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* CRUD on GENERIC graphs — no authored/pad distinction. Rename, duplicate, and delete go
   through real store mutators (autosave-consistent) and work on ANY graph key (pad graphs
   included). Pad-label hydration seeds a friendly name onto every pad-keyed graph. deleteGraph
   purges the graph from every section across ALL songs (no dangling refs); a deleted pad graph
   leaves its pad silent with no respawn (hit-resolution is by trigger source). */

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

const kickCentre = (store: TriggerLab) => store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!;

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

describe('pad-label hydration', () => {
  it('seeds a friendly display name for every pad graph (no raw keys)', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.graphNames['kick:0']).toBe('Kick · center');
    // every named key is a real graph, and none are authored — the seed has only pad graphs.
    expect(Object.keys(store.graphNames).every((k) => k in store.graphs)).toBe(true);
    expect(Object.keys(store.graphNames).some((k) => k.startsWith('graph-') || k.startsWith('graph:'))).toBe(false);
  });

  it('graphLabel resolves a pad key to its friendly name', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.graphLabel('kick:0')).toBe('Kick · center');
  });

  it('does not overwrite a user rename of a pad graph across reload (idempotent)', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      store.renameGraph('kick:0', 'Big Kick');
      store.stop();

      const reloaded = new TriggerLab(fakeClient);
      expect(reloaded.graphNames['kick:0']).toBe('Big Kick'); // hydrate left the rename alone
    });
  });
});

describe('renameGraph (any graph)', () => {
  it('relabels an authored graph (graphNames + graphLabel)', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Original');
    store.renameGraph(key, 'My Graph');
    expect(store.graphNames[key]).toBe('My Graph');
    expect(store.graphLabel(key)).toBe('My Graph');
  });

  it('relabels a PAD graph (graphNames + graphLabel)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameGraph('kick:0', 'Thump');
    expect(store.graphNames['kick:0']).toBe('Thump');
    expect(store.graphLabel('kick:0')).toBe('Thump');
  });

  it('keeps the existing label on a blank name (no clear)', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Keep Me');
    store.renameGraph(key, '   ');
    expect(store.graphNames[key]).toBe('Keep Me');
  });

  it('no-ops on an unknown key (no phantom graphNames entry)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameGraph('graph-999999', 'Ghost');
    expect('graph-999999' in store.graphNames).toBe(false);
  });
});

describe('duplicateGraph (any graph)', () => {
  it('clones an authored graph under a fresh key with a "copy" label, selecting it', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.createGraph('Sparkler');
    const clone = store.duplicateGraph(src)!;
    expect(clone).not.toBe(src);
    expect(clone.startsWith('graph-')).toBe(true);
    expect(store.graphs[clone]).toBeDefined();
    expect(store.graphNames[clone]).toBe('Sparkler copy');
    expect(store.selectedPadKey).toBe(clone); // selected for editing
  });

  it('clones a PAD graph under a fresh authored key, label "<pad> copy", source copied', () => {
    const store = new TriggerLab(fakeClient);
    const clone = store.duplicateGraph('kick:0')!;
    expect(clone.startsWith('graph-')).toBe(true); // a first-class generic graph, not a pad key
    expect(store.graphNames[clone]).toBe('Kick · center copy');
    // trigger source copied verbatim — the clone still fires the kick centre until rebound.
    expect(store.triggerSource(clone)).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
  });

  it('produces an independent clone (editing the clone does not touch the source)', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.createGraph('Src');
    const clone = store.duplicateGraph(src)!;
    const beforeSrcNodes = store.graphs[src]!.nodes.length;
    store.selectedPadKey = clone;
    store.addNode('play', 0, 0); // mutate only the clone's graph
    expect(store.graphs[clone]!.nodes.length).toBe(beforeSrcNodes + 1);
    expect(store.graphs[src]!.nodes.length).toBe(beforeSrcNodes); // source untouched
  });

  it('returns null on an unknown key', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.duplicateGraph('graph-999999')).toBeNull();
  });
});

describe('deleteGraph (any graph)', () => {
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

  it('deletes a PAD graph too (gone from graphs, graphNames, its seeded sections)', () => {
    const store = new TriggerLab(fakeClient);
    const sectionsWithKick = store.activeSong!.sections.filter((s) => s.graphs.includes('kick:0')).length;
    expect(sectionsWithKick).toBeGreaterThan(0); // seeded into sections

    store.deleteGraph('kick:0');
    expect(store.graphs['kick:0']).toBeUndefined();
    expect('kick:0' in store.graphNames).toBe(false);
    expect(store.graphLibrary.some((g) => g.key === 'kick:0')).toBe(false);
    for (const song of store.songs) for (const sec of song.sections) expect(sec.graphs).not.toContain('kick:0');
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

  it('no-ops on an unknown key', () => {
    const store = new TriggerLab(fakeClient);
    const before = Object.keys(store.graphs).length;
    store.deleteGraph('graph-999999');
    expect(Object.keys(store.graphs).length).toBe(before);
  });
});

describe('deleted pad graph → silence, no respawn', () => {
  it('a hit on the pad fires nothing once its graph is deleted', () => {
    const store = new TriggerLab(fakeClient);
    store.deleteGraph('kick:0'); // also purges it from the active section
    store.hit(kickCentre(store));
    expect(store.log).toHaveLength(0); // no graph resolves for the pad → silent
  });

  it('does not respawn the pad graph across a reload', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      store.deleteGraph('kick:0');
      store.stop(); // flush authored slice → localStorage

      const reloaded = new TriggerLab(fakeClient); // a "reload" hydrates from storage
      expect(reloaded.graphs['kick:0']).toBeUndefined(); // gone, not reseeded
      expect('kick:0' in reloaded.graphNames).toBe(false);
      for (const song of reloaded.songs) for (const s of song.sections) expect(s.graphs).not.toContain('kick:0');
    });
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
