// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import {
  SHOWS_STORAGE_KEY,
  serializeShowLibrary,
  type AuthoredState,
  type ShowLibrary,
} from './persistence';
import { makeNode, type TriggerGraph } from './sim';
import type { WSClient } from '../ws/client';

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
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemStorage(),
    configurable: true,
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function persistLibrary(suffix: number, graph: TriggerGraph): { graphKey: string; sectionId: string } {
  const graphKey = `graph-${suffix}`;
  const sectionId = `section-${suffix}`;
  const songId = `song-${suffix}`;
  const showId = `show-${suffix}`;
  const authored = {
    graphs: { [graphKey]: graph },
    graphNames: { [graphKey]: 'Reloaded graph' },
    songs: [{ id: songId, name: 'Song', sections: [{ id: sectionId, name: 'Section', graphs: [graphKey] }] }],
    buses: [],
    presets: [],
    effects: [],
    selectedPadKey: graphKey,
    activeSongId: songId,
    activeSectionId: sectionId,
    bpm: 120,
    velocity: 0.85,
    beatsPerBar: 4,
    paneSizes: {},
    patchLabels: {},
  } as AuthoredState;
  const lib: ShowLibrary = {
    activeShowId: showId,
    shows: { [showId]: { id: showId, name: 'Reloaded Show', authored } },
  };
  localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify(serializeShowLibrary(lib)));
  return { graphKey, sectionId };
}

describe('TriggerLab persisted id reservation', () => {
  it('does not reuse a persisted node id after reload', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('all', 'n-9000', 100, 100)],
      edges: [{ id: 'e-9000', from: 'trigger', to: 'n-9000' }],
    };
    const { graphKey } = persistLibrary(9000, graph);

    const store = new TriggerLab(fakeClient);
    const added = store.addNode('play', 300, 400);

    expect(store.selectedPadKey).toBe(graphKey);
    expect(added?.id).not.toBe('n-9000');
    const ids = store.graphs[graphKey]!.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not reuse a persisted edge id after reload', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('all', 'n-9100', 100, 100)],
      edges: [{ id: 'e-9100', from: 'trigger', to: 'n-9100' }],
    };
    const { graphKey } = persistLibrary(9100, graph);

    const store = new TriggerLab(fakeClient);
    const added = store.addNode('play', 300, 400)!;
    store.connect('n-9100', added.id);

    const ids = store.graphs[graphKey]!.edges.map((e) => e.id);
    expect(ids).toContain('e-9100');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not reuse a persisted section id after reload', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0)],
      edges: [],
    };
    const { sectionId } = persistLibrary(9200, graph);

    const store = new TriggerLab(fakeClient);
    store.copySection(sectionId);
    store.pasteSection();

    const ids = store.activeSong!.sections.map((s) => s.id);
    expect(ids).toContain(sectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
