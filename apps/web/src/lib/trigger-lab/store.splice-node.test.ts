import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the splice-node mutators. The behaviour worth pinning is the
   bookkeeping the render path depends on: the authored rows and the band count stay in step,
   growing CYCLES the existing colours (so raising the count never silently adds dark gaps),
   and the last splice can't be removed (a splice node with no splices renders nothing). */

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

function withSplice(): { store: TriggerLab; node: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const node = store.addNode('splice', 200, 0)!;
  return { store, node };
}

const colours = (node: GraphNode): (string | null | undefined)[] => (node.splices ?? []).map((s) => s.color);

describe('addNode("splice")', () => {
  it('seeds four colour splices so a fresh node cuts visibly instead of rendering nothing', () => {
    const { node } = withSplice();
    expect(node.kind).toBe('splice');
    expect(node.spliceCount).toBe(4);
    expect(node.splices).toHaveLength(4);
    expect(colours(node).every((c) => typeof c === 'string' && c.startsWith('#'))).toBe(true);
    expect(new Set(colours(node)).size, 'four DISTINCT colours').toBe(4);
    expect(node.splicePartition).toBe('hoop');
  });

  it('auto-wires to the Output anchor, like an Effect — it makes light of its own', () => {
    const { store, node } = withSplice();
    const graph = store.selectedGraph!;
    const output = graph.nodes.find((n) => n.kind === 'output')!;
    expect(graph.edges.some((e) => e.from === node.id && e.to === output.id)).toBe(true);
  });
});

describe('setSpliceCount', () => {
  it('grows the authored rows by CYCLING the existing colours, not by adding blanks', () => {
    const { store, node } = withSplice();
    store.setSpliceCount(node, 6);
    expect(node.spliceCount).toBe(6);
    expect(node.splices).toHaveLength(6);
    expect(colours(node)[4]).toBe(colours(node)[0]);
    expect(colours(node)[5]).toBe(colours(node)[1]);
  });

  it('shrinks from the end, keeping the leading rows', () => {
    const { store, node } = withSplice();
    const first = colours(node)[0];
    store.setSpliceCount(node, 2);
    expect(node.spliceCount).toBe(2);
    expect(node.splices).toHaveLength(2);
    expect(colours(node)[0]).toBe(first);
  });

  it('clamps to the authorable range and ignores a no-op', () => {
    const { store, node } = withSplice();
    store.setSpliceCount(node, 0);
    expect(node.spliceCount).toBe(1);
    store.setSpliceCount(node, 9999);
    expect(node.spliceCount).toBe(64);
    store.setSpliceCount(node, 64);
    expect(node.spliceCount).toBe(64);
  });

  it('leaves a non-splice node alone', () => {
    const { store } = withSplice();
    const delay = store.addNode('delay', 300, 0)!;
    store.setSpliceCount(delay, 8);
    expect(delay.spliceCount).toBeUndefined();
  });
});

describe('setSpliceAt', () => {
  it('sets and clears a splice colour', () => {
    const { store, node } = withSplice();
    store.setSpliceAt(node, 1, { color: '#123456' });
    expect(node.splices![1]!.color).toBe('#123456');
    store.setSpliceAt(node, 1, { color: null });
    expect(node.splices![1]!.color).toBeNull();
  });

  it('sets and clears a splice effect without touching its colour', () => {
    const { store, node } = withSplice();
    const colour = node.splices![0]!.color;
    store.setSpliceAt(node, 0, { effectId: 'gen:plasma' });
    expect(node.splices![0]!.effectId).toBe('gen:plasma');
    expect(node.splices![0]!.color).toBe(colour);
    store.setSpliceAt(node, 0, { effectId: undefined });
    expect(node.splices![0]!.effectId).toBeUndefined();
    expect(node.splices![0]!.color).toBe(colour);
  });

  it('mutes and unmutes a splice, keeping what is authored on it', () => {
    const { store, node } = withSplice();
    const colour = node.splices![2]!.color;
    store.setSpliceAt(node, 2, { muted: true });
    expect(node.splices![2]!.muted).toBe(true);
    expect(node.splices![2]!.color).toBe(colour);
    store.setSpliceAt(node, 2, { muted: false });
    expect(node.splices![2]!.muted).toBe(false);
  });

  it('materialises a slot that was only being filled by the cycling fallback', () => {
    const { store, node } = withSplice();
    node.splices = [{ color: '#ff0000' }];
    node.spliceCount = 4;
    store.setSpliceAt(node, 3, { color: '#00ff00' });
    expect(node.splices).toHaveLength(4);
    expect(node.splices![3]!.color).toBe('#00ff00');
    expect(node.splices![1]).toEqual({}); // padded, not cloned — it keeps cycling until edited
  });

  it('ignores an out-of-range index rather than growing the list without bound', () => {
    const { store, node } = withSplice();
    store.setSpliceAt(node, -1, { color: '#fff' });
    store.setSpliceAt(node, 999, { color: '#fff' });
    expect(node.splices).toHaveLength(4);
  });
});

describe('addSplice / removeSplice', () => {
  it('appends a splice and keeps the band count in step', () => {
    const { store, node } = withSplice();
    store.addSplice(node);
    expect(node.splices).toHaveLength(5);
    expect(node.spliceCount).toBe(5);
  });

  it('removes a splice and keeps the band count in step', () => {
    const { store, node } = withSplice();
    const second = node.splices![1]!.color;
    store.removeSplice(node, 0);
    expect(node.splices).toHaveLength(3);
    expect(node.spliceCount).toBe(3);
    expect(node.splices![0]!.color).toBe(second);
  });

  it('refuses to remove the last splice — that is a node deletion, not an edit', () => {
    const { store, node } = withSplice();
    store.setSpliceCount(node, 1);
    store.removeSplice(node, 0);
    expect(node.splices).toHaveLength(1);
  });
});

describe('scope', () => {
  // The shipped bug: setScope/setTargetId guard on node kind and did not list 'splice', so
  // the inspector's control was a silent no-op and every splice lit the whole kit.
  it('aims a splice at one drum', () => {
    const { store, node } = withSplice();
    expect(node.scope, 'a fresh splice is kit-wide').toBe('kit');
    store.setScope(node, 'drum');
    store.setTargetId(node, 'snare');
    expect(node.scope).toBe('drum');
    expect(node.targetId).toBe('snare');
  });

  it('aims a splice at one hoop', () => {
    const { store, node } = withSplice();
    store.setScope(node, 'hoop');
    store.setTargetId(node, 'tom1#2');
    expect(node.scope).toBe('hoop');
    expect(node.targetId).toBe('tom1#2');
  });

  it('clears a stale target when the scope changes', () => {
    const { store, node } = withSplice();
    store.setScope(node, 'drum');
    store.setTargetId(node, 'snare');
    store.setScope(node, 'kit');
    expect(node.targetId).toBeUndefined();
  });
});

describe('envelope + motion mode', () => {
  it('sets how long the lights stay up after a hit', () => {
    const { store, node } = withSplice();
    store.setSpliceSetting(node, { spliceAttackMs: 5, spliceHoldMs: 2500, spliceReleaseMs: 800 });
    expect(node.spliceAttackMs).toBe(5);
    expect(node.spliceHoldMs).toBe(2500);
    expect(node.spliceReleaseMs).toBe(800);
  });

  it('switches between restart and continuous', () => {
    const { store, node } = withSplice();
    expect(node.spliceMotionMode, 'restart is the default').toBeUndefined();
    store.setSpliceSetting(node, { spliceMotionMode: 'continuous' });
    expect(node.spliceMotionMode).toBe('continuous');
  });
});

describe('setSpliceSetting', () => {
  it('patches motion settings and leaves the rest alone', () => {
    const { store, node } = withSplice();
    store.setSpliceSetting(node, { spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 900 });
    expect(node.spliceChase).toBe('smooth');
    expect(node.spliceRateMode).toBe('time');
    expect(node.spliceRateMs).toBe(900);
    expect(node.splicePartition).toBe('hoop');
    expect(node.splices).toHaveLength(4);
  });

  it('leaves a non-splice node alone', () => {
    const { store } = withSplice();
    const delay = store.addNode('delay', 300, 0)!;
    store.setSpliceSetting(delay, { spliceChase: 'step' });
    expect(delay.spliceChase).toBeUndefined();
  });
});

describe('undo', () => {
  it('reverts a splice edit through the normal undo stack', () => {
    const { store, node } = withSplice();
    const before = node.splices![0]!.color;
    store.setSpliceAt(node, 0, { color: '#010203' });
    expect(store.selectedGraph!.nodes.find((n) => n.id === node.id)!.splices![0]!.color).toBe('#010203');
    store.undo();
    expect(store.selectedGraph!.nodes.find((n) => n.id === node.id)!.splices![0]!.color).toBe(before);
  });
});
