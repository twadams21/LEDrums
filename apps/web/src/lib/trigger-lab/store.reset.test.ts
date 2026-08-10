import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { STORAGE_KEY, serializeAuthored, type AuthoredState } from './persistence';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the reset-node mutator `setResetTarget`. The target is a
   (graph key, node id) pair pointing at a `sequence` node — usually in a DIFFERENT graph than the
   reset itself, which is the whole point of the node. Mirrors store.delay.test.ts. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** A store with a sequence node in graph A and a reset node in a second graph B. */
function withResetAndTarget(): { store: TriggerLab; reset: GraphNode; seqKey: string; seqId: string } {
  const store = new TriggerLab(fakeClient);
  const seqKey = store.createGraph('target graph');
  const seq = store.addNode('sequence', 200, 0)!;
  store.createGraph('footswitch graph');
  const reset = store.addNode('reset', 200, 0)!;
  return { store, reset, seqKey, seqId: seq.id };
}

describe('setResetTarget', () => {
  it('points a reset node at a sequence node in another graph', () => {
    const { store, reset, seqKey, seqId } = withResetAndTarget();
    expect(reset.targetGraphKey).toBeUndefined(); // unset by default
    expect(reset.targetNodeId).toBeUndefined();

    store.setResetTarget(reset, seqKey, seqId);
    expect(reset.targetGraphKey).toBe(seqKey);
    expect(reset.targetNodeId).toBe(seqId);
  });

  it('clears the target back to unset when passed nulls', () => {
    const { store, reset, seqKey, seqId } = withResetAndTarget();
    store.setResetTarget(reset, seqKey, seqId);
    store.setResetTarget(reset, null, null);
    expect(reset.targetGraphKey).toBeUndefined();
    expect(reset.targetNodeId).toBeUndefined();
  });

  it('re-points an already-targeted reset', () => {
    const { store, reset, seqKey, seqId } = withResetAndTarget();
    store.setResetTarget(reset, seqKey, seqId);
    const otherKey = store.createGraph('another');
    const otherSeq = store.addNode('sequence', 300, 0)!;
    store.setResetTarget(reset, otherKey, otherSeq.id);
    expect(reset.targetGraphKey).toBe(otherKey);
    expect(reset.targetNodeId).toBe(otherSeq.id);
  });

  it('is a no-op on a non-reset node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const seq = store.addNode('sequence', 200, 0)!;
    store.setResetTarget(seq, 'some-graph', 'some-node');
    expect(seq.targetGraphKey).toBeUndefined();
    expect(seq.targetNodeId).toBeUndefined();
  });

  it('survives a serialize → reload round-trip', () => {
    const { store, reset, seqKey, seqId } = withResetAndTarget();
    store.setResetTarget(reset, seqKey, seqId);
    const graphKey = store.selectedPadKey!;

    // persist the graphs the way the authored autosave would, then hydrate a fresh store
    const slice: Partial<AuthoredState> = { graphs: store.graphs, graphNames: store.graphNames };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(slice as AuthoredState)));
    const reloaded = new TriggerLab(fakeClient);

    const node = reloaded.graphs[graphKey]!.nodes.find((n) => n.kind === 'reset')!;
    expect(node.targetGraphKey).toBe(seqKey);
    expect(node.targetNodeId).toBe(seqId);
  });
});

describe('setResetSource', () => {
  it('binds a reset node to its own MIDI note, making it an independent entry point', () => {
    const { store, reset } = withResetAndTarget();
    expect(reset.source).toBeUndefined(); // unbound: fires from the graph's trigger flow
    store.setResetSource(reset, { kind: 'midi', note: 61 });
    expect(reset.source).toEqual({ kind: 'midi', note: 61 });
  });

  it('binds an OSC address', () => {
    const { store, reset } = withResetAndTarget();
    store.setResetSource(reset, { kind: 'osc', address: '/reset' });
    expect(reset.source).toEqual({ kind: 'osc', address: '/reset' });
  });

  it('clears the binding back to plain flow behaviour', () => {
    const { store, reset } = withResetAndTarget();
    store.setResetSource(reset, { kind: 'midi', note: 61 });
    store.setResetSource(reset, null);
    expect(reset.source).toBeUndefined();
  });

  it('is a no-op on a non-reset node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const seq = store.addNode('sequence', 200, 0)!;
    const before = seq.source;
    store.setResetSource(seq, { kind: 'midi', note: 61 });
    expect(seq.source).toBe(before);
  });

  it('survives a reload', () => {
    const { store, reset, seqKey, seqId } = withResetAndTarget();
    store.setResetTarget(reset, seqKey, seqId);
    store.setResetSource(reset, { kind: 'midi', note: 61 });
    const graphKey = store.selectedPadKey!;

    const slice: Partial<AuthoredState> = { graphs: store.graphs, graphNames: store.graphNames };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(slice as AuthoredState)));
    const reloaded = new TriggerLab(fakeClient);

    const node = reloaded.graphs[graphKey]!.nodes.find((n) => n.kind === 'reset')!;
    expect(node.source).toEqual({ kind: 'midi', note: 61 });
  });
});

describe('makeNode defaults for reset', () => {
  it('seeds a reset node with no target (a no-op until pointed somewhere)', () => {
    const { reset } = withResetAndTarget();
    expect(reset.kind).toBe('reset');
    expect(reset.targetGraphKey).toBeUndefined();
    expect(reset.targetNodeId).toBeUndefined();
  });
});
