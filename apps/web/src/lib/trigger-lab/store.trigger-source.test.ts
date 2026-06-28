import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { makeNode, type TriggerGraph } from './sim';
import { STORAGE_KEY, VERSION } from './persistence';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the trigger-source back-compat default + mutators (U1 T1).
   The pure sim tests can't reach hydrate: every pad-bound graph must gain an explicit
   `drum` source from its padKey on construction, idempotently, while authored graphs and
   already-explicit sources are left alone. */

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

describe('trigger-source back-compat default (hydrate)', () => {
  it('gives every seeded pad graph an explicit drum source from its padKey', () => {
    const store = new TriggerLab(fakeClient);
    const entries = Object.entries(store.graphs);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, graph] of entries) {
      const trig = graph.nodes.find((n) => n.kind === 'trigger')!;
      const sep = key.indexOf(':');
      expect(trig.source).toEqual({ kind: 'drum', drumId: key.slice(0, sep), zone: key.slice(sep + 1) });
    }
  });

  it('leaves an authored graph (createGraph) source unset — it is not pad-bound', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Authored');
    expect(store.triggerSource(key)).toBeUndefined();
  });
});

describe('trigger-source hydrate is idempotent + respects explicit sources', () => {
  it('keeps an already-explicit source and only fills the missing ones', () => {
    // a persisted blob: kick:0 already carries an explicit MIDI source; snare:0 has none.
    const sourced: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'midi', note: 60 } })],
      edges: [],
    };
    const bare: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 0, 0)], edges: [] };
    const blob = { version: VERSION, data: { graphs: { 'kick:0': sourced, 'snare:0': bare } } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));

    const store = new TriggerLab(fakeClient);
    // the explicit MIDI source is untouched (not overwritten with a drum default)
    expect(store.triggerSource('kick:0')).toEqual({ kind: 'midi', note: 60 });
    // the bare pad graph picked up its drum default from the padKey
    expect(store.triggerSource('snare:0')).toEqual({ kind: 'drum', drumId: 'snare', zone: '0' });
  });
});

describe('trigger-source mutators', () => {
  it('setTriggerSource writes the source onto the graph trigger node', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Authored');
    store.setTriggerSource(key, { kind: 'osc', address: '/kick' });
    expect(store.triggerSource(key)).toEqual({ kind: 'osc', address: '/kick' });
    // it lands on the actual trigger node inside `graphs`, so the authored autosave persists it
    const trig = store.graphs[key]!.nodes.find((n) => n.kind === 'trigger')!;
    expect(trig.source).toEqual({ kind: 'osc', address: '/kick' });
  });

  it('setTriggerSource can re-bind a pad graph from drum to midi', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    store.setTriggerSource(key, { kind: 'midi', cc: 7 });
    expect(store.triggerSource(key)).toEqual({ kind: 'midi', cc: 7 });
  });

  it('setTriggerSource is a no-op for an unknown graph key', () => {
    const store = new TriggerLab(fakeClient);
    expect(() => store.setTriggerSource('nope:0', { kind: 'osc', address: '/x' })).not.toThrow();
    expect(store.triggerSource('nope:0')).toBeUndefined();
  });
});
