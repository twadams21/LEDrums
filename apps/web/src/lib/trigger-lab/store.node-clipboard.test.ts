import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Node-level copy / paste / duplicate store surface (trigger-graph context menu). Node-only —
   wires are never captured; the trigger node is never copyable/duplicable/deletable. */

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

function freshGraph(): { store: TriggerLab; play: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const play = store.addNode('play', 200, 0)!;
  return { store, play };
}

const nodesOf = (store: TriggerLab) => store.selectedGraph!.nodes;

describe('node clipboard', () => {
  it('copyNode captures a deep, non-reactive snapshot', () => {
    const { store, play } = freshGraph();
    store.copyNode(play);
    expect(store.nodeClipboard).not.toBeNull();
    expect(store.nodeClipboard!.kind).toBe('play');
    // mutating the source must not leak into the clipboard copy
    play.x = 999;
    expect(store.nodeClipboard!.x).toBe(200);
  });

  it('pasteNode clones into the graph with a fresh id + non-overlapping position', () => {
    const { store, play } = freshGraph();
    const before = nodesOf(store).length;
    store.copyNode(play);
    const pasted = store.pasteNode()!;
    expect(nodesOf(store).length).toBe(before + 1);
    expect(pasted.id).not.toBe(play.id);
    expect(pasted.kind).toBe('play');
    // offset from the original, so it does not stack on it
    expect(pasted.x === play.x && pasted.y === play.y).toBe(false);
  });

  it('pasteNode is a no-op with an empty clipboard', () => {
    const { store } = freshGraph();
    const before = nodesOf(store).length;
    expect(store.pasteNode()).toBeNull();
    expect(nodesOf(store).length).toBe(before);
  });

  it('duplicateNode adds an independent copy', () => {
    const { store, play } = freshGraph();
    const before = nodesOf(store).length;
    const dup = store.duplicateNode(play)!;
    expect(nodesOf(store).length).toBe(before + 1);
    expect(dup.id).not.toBe(play.id);
    expect(dup.kind).toBe('play');
  });

  it('refuses to copy or duplicate the trigger node', () => {
    const { store } = freshGraph();
    const trigger = store.selectedGraph!.nodes.find((n) => n.kind === 'trigger')!;
    store.copyNode(trigger);
    expect(store.nodeClipboard).toBeNull();
    expect(store.duplicateNode(trigger)).toBeNull();
  });
});
