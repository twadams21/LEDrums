import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { makeNode, type GraphNode, type TriggerGraph } from './sim';
import type { WSClient } from '../ws/client';

/* S39 — presets are snapshots, params are node-local. These pin the acceptance criteria:
   editing one play node can NEVER change another (no shared-preset write-through), the
   Apply/Save preset actions behave, and an authored graph round-trips through persistence
   with no `linked` flag. Mirrors store.objects.test.ts's harness. */

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

/** The first numeric param key of an effect — a real param to author onto. */
function numKey(store: TriggerLab, effectId: string): string {
  return store.effects.find((e) => e.id === effectId)!.params.find((p) => p.kind === 'number')!.key;
}

/** Inject a graph with two play nodes both forked from `swirl:wide` (a shared provenance preset). */
function twoNodeGraph(store: TriggerLab): { A: GraphNode; B: GraphNode } {
  const wide = store.presetById('gen:helix:default')!;
  const graph: TriggerGraph = {
    nodes: [
      makeNode('play', 'A', 0, 0, { effectId: 'gen:helix', presetId: 'gen:helix:default', params: { ...wide.params } }),
      makeNode('play', 'B', 0, 0, { effectId: 'gen:helix', presetId: 'gen:helix:default', params: { ...wide.params } }),
    ],
    edges: [],
  };
  store.graphs = { ...store.graphs, g: graph };
  const nodes = store.graphs['g']!.nodes;
  return { A: nodes[0]!, B: nodes[1]! };
}

describe('setParam — always node-local (S39)', () => {
  it('editing node A never changes node B or the shared preset', () => {
    const store = new TriggerLab(fakeClient);
    const key = numKey(store, 'gen:helix');
    const { A, B } = twoNodeGraph(store);
    const bBefore = B.params[key];
    const presetBefore = store.presetById('gen:helix:default')!.params[key];

    store.setParam(A, key, 0.123);

    expect(A.params[key]).toBe(0.123);
    expect(B.params[key]).toBe(bBefore); // no cross-node bleed
    expect(store.presetById('gen:helix:default')!.params[key]).toBe(presetBefore); // preset never written through
  });
});

describe('preset Apply / Save (S39)', () => {
  it('selectPreset forks a private copy of the preset params onto the node', () => {
    const store = new TriggerLab(fakeClient);
    const { A } = twoNodeGraph(store);
    store.selectPreset(A, 'gen:helix:default');
    const fast = store.presetById('gen:helix:default')!;
    expect(A.presetId).toBe('gen:helix:default');
    expect(A.params).toEqual(fast.params);
    expect(A.params).not.toBe(fast.params); // a copy, not the shared object
  });

  it('applyPreset resets node params to its current preset, discarding local edits', () => {
    const store = new TriggerLab(fakeClient);
    const key = numKey(store, 'gen:helix');
    const { A } = twoNodeGraph(store);
    store.setParam(A, key, 0.99); // diverge from the preset
    store.applyPreset(A);
    expect(A.params).toEqual(store.presetById(A.presetId)!.params);
  });

  it('saveNodeAsPreset snapshots the node params into a new preset for its effect', () => {
    const store = new TriggerLab(fakeClient);
    const key = numKey(store, 'gen:helix');
    const { A } = twoNodeGraph(store);
    store.setParam(A, key, 0.42);
    const before = store.presetsForEffect('gen:helix').length;

    const id = store.saveNodeAsPreset(A, 'My Snapshot')!;

    const saved = store.presetById(id)!;
    expect(saved.effectId).toBe('gen:helix');
    expect(saved.name).toBe('My Snapshot');
    expect(saved.params[key]).toBe(0.42); // captured the node's edited params
    expect(saved.params).not.toBe(A.params); // an independent copy
    expect(A.presetId).toBe(id); // node points at its new provenance preset
    expect(store.presetsForEffect('gen:helix').length).toBe(before + 1);
    // A later node edit must not mutate the saved preset (snapshot, not binding).
    store.setParam(A, key, 0.1);
    expect(store.presetById(id)!.params[key]).toBe(0.42);
  });
});

describe('persistence round-trips without the linked flag (S39)', () => {
  it('an authored graph with node-local params survives a reload; no `linked` field', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      const key = numKey(store, 'gen:helix');
      const { A } = twoNodeGraph(store);
      store.setParam(A, key, 0.37);
      store.stop(); // flush authored slice → localStorage

      const reloaded = new TriggerLab(fakeClient); // "reload" hydrates from storage
      const node = reloaded.graphs['g']?.nodes.find((n) => n.id === 'A');
      expect(node).toBeDefined();
      expect(node!.params[key]).toBe(0.37);
      expect('linked' in (node as unknown as Record<string, unknown>)).toBe(false);
    });
  });
});
