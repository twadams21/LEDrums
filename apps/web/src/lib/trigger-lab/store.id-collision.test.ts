import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import type { GraphNode } from './sim';

/* R15/R25 — node/edge mints dedupe against the graph's own ids. The `nid` counter resets to its
   base on every reload, so a bare mint could re-issue an id a persisted (or pasted) node already
   carries — and a duplicate id silently breaks select-by-id (the inspector resolves to the first
   match). `addNode` / `addPlayNode` / `connect` route through `freshId`, which skips a taken id. */

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

function freshGraph(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  return store;
}

const graphOf = (store: TriggerLab) => store.selectedGraph!;
const seqOf = (id: string) => Number(id.split('-')[1]);

describe('id-collision safety at the mint sites (R15/R25)', () => {
  it('addNode skips a node id already present in the graph', () => {
    const store = freshGraph();
    const a = store.addNode('mix', 0, 0)!;

    // Simulate a persisted graph carrying the very id the next bare `nid('n')` would re-mint after a
    // counter reset: inject a node with `n-<a+1>`. Only `.id` is read by the dedup check.
    const colliding = `n-${seqOf(a.id) + 1}`;
    graphOf(store).nodes.push({ id: colliding } as unknown as GraphNode);

    const b = store.addNode('mix', 100, 0)!;
    expect(b.id).not.toBe(colliding);
    const ids = graphOf(store).nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // every node id is unique
  });

  it('connect skips an edge id already present in the graph', () => {
    const store = freshGraph();
    const src = store.addNode('mix', 0, 0)!;
    const dst = store.addNode('mix', 200, 0)!;

    // A freshly-minted edge would be `e-<K>`; seed the graph with that exact id so the mint must skip.
    const firstEdge = store.connect(src.id, dst.id);
    expect(firstEdge).toBeNull(); // wire accepted
    const existingEdgeId = graphOf(store).edges.at(-1)!.id;
    graphOf(store).edges.push({ id: `e-${seqOf(existingEdgeId) + 1}`, from: src.id, to: dst.id } as never);

    const other = store.addNode('mix', 400, 0)!;
    expect(store.connect(dst.id, other.id)).toBeNull();
    const edgeIds = graphOf(store).edges.map((e) => e.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length); // every edge id is unique
  });
});
