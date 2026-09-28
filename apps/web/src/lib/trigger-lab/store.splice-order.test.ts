import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Reordering Splice / Slice rows (Tim, 2026-09-28: re-ordering a set of colours meant dialling each
   one again). A row moves whole — colour, effect, mute — and what plays is what is shown, even for
   rows that were only showing a cycled colour. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
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

function setup(kind: 'splice' | 'slice' = 'splice') {
  const store = new TriggerLab(fakeClient);
  const id = store.addNode(kind, 200, 0)!.id;
  const node = (): GraphNode => store.selectedGraph!.nodes.find((n) => n.id === id)!;
  store.setSpliceCount(node(), 3);
  store.setSpliceAt(node(), 0, { color: '#ff0000' });
  store.setSpliceAt(node(), 1, { color: '#00ff00', effectId: 'plasma' });
  store.setSpliceAt(node(), 2, { color: '#0000ff', muted: true });
  return { store, node };
}
const colours = (node: GraphNode) => node.splices!.map((s) => s.color);

describe('moveSplice', () => {
  it('moves a whole row — colour, effect and mute travel together', () => {
    const { store, node } = setup();
    store.moveSplice(node(), 0, 3); // first → after the last
    expect(colours(node())).toEqual(['#00ff00', '#0000ff', '#ff0000']);
    expect(node().splices![0]).toMatchObject({ effectId: 'plasma' });
    expect(node().splices![1]).toMatchObject({ muted: true });
  });

  it('moves up as well as down, and a no-op gap changes nothing', () => {
    const { store, node } = setup();
    store.moveSplice(node(), 2, 0);
    expect(colours(node())).toEqual(['#0000ff', '#ff0000', '#00ff00']);
    const before = JSON.stringify(node().splices);
    store.moveSplice(node(), 1, 1);
    store.moveSplice(node(), 1, 2);
    expect(JSON.stringify(node().splices)).toBe(before);
  });

  it('is one undo step', () => {
    const { store, node } = setup();
    store.moveSplice(node(), 0, 3);
    store.undo();
    expect(colours(node())).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('makes cycled rows real, as independent copies, so the shown order is the played order', () => {
    const { store, node } = setup();
    store.setSpliceCount(node(), 5); // rows 4 and 5 now show red, green again (cycled)
    const authored = node().splices!.length;
    store.moveSplice(node(), 4, 0); // the 5th row (green, cycled) to the top
    expect(node().splices).toHaveLength(Math.max(authored, 5));
    expect(colours(node())).toEqual(['#00ff00', '#ff0000', '#00ff00', '#0000ff', '#ff0000']);
    store.setSpliceAt(node(), 0, { color: '#ffffff' });
    expect(colours(node())[2]).toBe('#00ff00'); // the other green is its own row
  });

  it('works on a Slice node too', () => {
    const { store, node } = setup('slice');
    store.moveSplice(node(), 1, 0);
    expect(colours(node())).toEqual(['#00ff00', '#ff0000', '#0000ff']);
  });
});
