import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import { toastStore } from '../ui/toast.svelte';

/* R04 — a freshly-added Effect auto-wires to the terminal Output anchor so it makes light on the
   next hit instead of sitting silent. The add + wire are ONE undoable action (a single Ctrl/Z
   reverts both), routed through the validated connect path, and announced with a toast. Only the
   light-making Effect node auto-wires; other kinds (modifier, envelope, mix, …) do not. */

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

/** A fresh store on a new (empty Gen3) authored graph — one trigger + one Output anchor, no edges. */
function freshGraph(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  return store;
}

const graphOf = (store: TriggerLab) => store.selectedGraph!;
const outputId = (store: TriggerLab) => graphOf(store).nodes.find((n) => n.kind === 'output')!.id;
const effectNodes = (store: TriggerLab) => graphOf(store).nodes.filter((n) => n.kind === 'effect');

describe('auto-wire Effect → Output on add (R04)', () => {
  it('wires a freshly-added effect to the terminal Output anchor', () => {
    const store = freshGraph();
    expect(graphOf(store).edges).toHaveLength(0);

    const effect = store.addNode('effect', 200, 0)!;

    const wire = graphOf(store).edges.find((e) => e.from === effect.id && e.to === outputId(store));
    expect(wire).toBeDefined();
    // exactly the one auto-wire — no stray extra edges
    expect(graphOf(store).edges).toHaveLength(1);
  });

  it('auto-wires a play node too (both map to the light-making Effect node)', () => {
    const store = freshGraph();
    const play = store.addNode('play', 200, 0)!;
    expect(play.kind).toBe('effect');
    expect(graphOf(store).edges.some((e) => e.from === play.id && e.to === outputId(store))).toBe(true);
  });

  it('announces the auto-wire with one info toast', () => {
    const store = freshGraph();
    store.addNode('effect', 200, 0);

    expect(toastStore.items).toHaveLength(1);
    expect(toastStore.items[0]!.tone).toBe('info');
    expect(toastStore.items[0]!.message).toMatch(/output/i);
  });

  it('reverts the add AND the auto-wire in a single undo step', () => {
    const store = freshGraph();
    store.addNode('effect', 200, 0);
    expect(effectNodes(store)).toHaveLength(1);
    expect(graphOf(store).edges).toHaveLength(1);

    const undone = store.undo();

    expect(undone).toBe(true);
    expect(effectNodes(store)).toHaveLength(0); // node gone
    expect(graphOf(store).edges).toHaveLength(0); // AND its wire gone — one step, not two
  });

  it('does not auto-wire non-Effect nodes', () => {
    const store = freshGraph();
    store.addNode('modifier', 100, 100);
    store.addNode('envelope', 0, 0);
    store.addNode('mix', 300, 0);

    // none of these are the light-making Effect node → no edges into Output
    expect(graphOf(store).edges.filter((e) => e.to === outputId(store))).toHaveLength(0);
  });

  it('skips silently (no throw, no toast) when the graph has no Output anchor', () => {
    const store = freshGraph();
    const g = graphOf(store);
    // strip the Output anchor to prove the auto-wire is belt-and-braces, not load-bearing
    g.nodes = g.nodes.filter((n) => n.kind !== 'output');

    const effect = store.addNode('effect', 200, 0)!;

    expect(effect.kind).toBe('effect'); // the node still added
    expect(g.edges).toHaveLength(0); // nothing wired
    expect(toastStore.items).toHaveLength(0); // and nothing announced
  });
});
