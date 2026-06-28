import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the delay-node mutators: setDelayMode / setDelayMs / setDivision.
   Validates round-trip reads, clamping, and the kind-guard (non-delay nodes are untouched). */

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

/** A fresh store with a delay node added to an authored graph. */
function withDelay(): { store: TriggerLab; node: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const node = store.addNode('delay', 200, 0)!;
  return { store, node };
}

describe('setDelayMode', () => {
  it('switches a delay node from time to beats', () => {
    const { store, node } = withDelay();
    expect(node.delayMode).toBe('time'); // seed default
    store.setDelayMode(node, 'beats');
    expect(node.delayMode).toBe('beats');
  });

  it('switches a delay node back to time', () => {
    const { store, node } = withDelay();
    store.setDelayMode(node, 'beats');
    store.setDelayMode(node, 'time');
    expect(node.delayMode).toBe('time');
  });

  it('is a no-op on a non-delay node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const play = store.addNode('play', 200, 0)!;
    const before = play.delayMode;
    store.setDelayMode(play, 'beats');
    expect(play.delayMode).toBe(before); // unchanged
  });
});

describe('setDelayMs', () => {
  it('sets the delay time in ms', () => {
    const { store, node } = withDelay();
    store.setDelayMs(node, 500);
    expect(node.ms).toBe(500);
  });

  it('clamps negative values to 0', () => {
    const { store, node } = withDelay();
    store.setDelayMs(node, -100);
    expect(node.ms).toBe(0);
  });

  it('accepts 0 (immediate fire)', () => {
    const { store, node } = withDelay();
    store.setDelayMs(node, 0);
    expect(node.ms).toBe(0);
  });

  it('is a no-op on a non-delay node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const seq = store.addNode('sequence', 200, 0)!;
    const before = seq.ms;
    store.setDelayMs(seq, 999);
    expect(seq.ms).toBe(before);
  });
});

describe('setDivision', () => {
  it('sets the division string on a delay node', () => {
    const { store, node } = withDelay();
    store.setDivision(node, '1/4');
    expect(node.division).toBe('1/4');
  });

  it('accepts every canonical delay division', () => {
    const { store, node } = withDelay();
    const divs = ['1/4', '1/8', '1/16', 'dotted-1/4', 'dotted-1/8', 'dotted-1/16', 'triplet-1/4', 'triplet-1/8', 'triplet-1/16'] as const;
    for (const d of divs) {
      store.setDivision(node, d);
      expect(node.division).toBe(d);
    }
  });

  it('is a no-op on a non-delay node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const chance = store.addNode('chance', 200, 0)!;
    const before = chance.division;
    store.setDivision(chance, '1/4');
    expect(chance.division).toBe(before);
  });
});

describe('makeNode defaults for delay', () => {
  it('seeds a delay node with time mode and 250ms', () => {
    const { node } = withDelay();
    expect(node.kind).toBe('delay');
    expect(node.delayMode).toBe('time');
    expect(node.ms).toBe(250);
    expect(node.division).toBe('1/8');
  });
});
