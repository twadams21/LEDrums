import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import { toastStore } from '../ui/toast.svelte';

/* F8 — a connection drag released in empty space summons the Add-node palette, and the picked
   node lands WITH the wire the drag was making. `addNodeWired` is that seam: the node and its
   wire are ONE undoable action, and the wire goes through the validated `connect` path, so a
   wire the graph would refuse by hand is refused here too. */

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
  toastStore.clear();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  toastStore.clear();
});

/** A fresh store on a new (empty Gen3) authored graph — one trigger + one Output anchor. */
function freshGraph(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  return store;
}

const graphOf = (store: TriggerLab) => store.selectedGraph!;

describe('addNodeWired (F8 wire-drop add)', () => {
  it('adds the node and lands the pending wire on it', () => {
    const store = freshGraph();
    const mix = store.addNode('mix', 400, 0)!;

    const added = store.addNodeWired('all', 200, 0, (node) => store.connect(node.id, mix.id));

    expect(added).not.toBeNull();
    expect(graphOf(store).nodes.some((n) => n.id === added!.id)).toBe(true);
    expect(graphOf(store).edges.some((e) => e.from === added!.id && e.to === mix.id)).toBe(true);
  });

  it('reverts the node AND its wire in a single undo step', () => {
    const store = freshGraph();
    const mix = store.addNode('mix', 400, 0)!;
    const edgesBefore = graphOf(store).edges.length;

    const added = store.addNodeWired('all', 200, 0, (node) => store.connect(node.id, mix.id))!;
    expect(graphOf(store).edges).toHaveLength(edgesBefore + 1);

    expect(store.undo()).toBe(true);

    expect(graphOf(store).nodes.some((n) => n.id === added.id)).toBe(false); // node gone
    expect(graphOf(store).edges).toHaveLength(edgesBefore); // AND its wire — one step, not two
  });

  it('keeps the added Effect auto-wire in the same single undo step', () => {
    // an Effect auto-wires to Output on add (R04); the pending wire batches on top of that, and
    // one Ctrl/Z still has to pop all three (node + auto-wire + pending wire).
    const store = freshGraph();
    const mix = store.addNode('mix', 400, 0)!;
    const edgesBefore = graphOf(store).edges.length;

    store.addNodeWired('effect', 200, 0, (node) => store.connect(node.id, mix.id));
    expect(graphOf(store).edges.length).toBe(edgesBefore + 2); // → Output, and → the Mix

    store.undo();

    expect(graphOf(store).edges).toHaveLength(edgesBefore);
  });

  it('still adds the node when the wire is refused, and refuses it for the same reason connect would', () => {
    const store = freshGraph();
    const fx = store.addNode('effect', 200, 0)!;
    const edgesBefore = graphOf(store).edges.length;

    // an envelope is a modulation source — it has no flow output, so a flow wire is `direction`
    let rejection: unknown = null;
    const added = store.addNodeWired('envelope', 0, 0, (node) => {
      rejection = store.connect(node.id, fx.id);
    })!;

    expect(rejection).toBe('direction');
    expect(graphOf(store).nodes.some((n) => n.id === added.id)).toBe(true);
    expect(graphOf(store).edges).toHaveLength(edgesBefore);
  });

  it('adds nothing and runs no wire for a read-only viewer', () => {
    const store = freshGraph();
    const mix = store.addNode('mix', 400, 0)!;
    const edgesBefore = graphOf(store).edges.length;
    let ran = false;

    (store as unknown as { isViewer: boolean }).isViewer = true;
    const added = store.addNodeWired('all', 200, 0, () => {
      ran = true;
      store.connect('a', mix.id);
    });

    expect(added).toBeNull();
    expect(ran).toBe(false);
    expect(graphOf(store).edges).toHaveLength(edgesBefore);
  });
});
