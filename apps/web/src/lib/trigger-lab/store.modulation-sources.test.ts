import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import { splitModulationSourceNodes } from './store/hydrate';
import { makeNode, type TriggerGraph } from './sim';

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('modulation source split migration', () => {
  it('migrates legacy ccSource osc nodes to osc and keeps MIDI CC as cc', () => {
    const graph: TriggerGraph = {
      nodes: [
        makeNode('cc', 'midi', 0, 0, { ccController: 12, ccSource: 'midi' }),
        makeNode('cc', 'osc-old', 0, 100, { ccSource: 'osc', oscAddress: '/fader/1' }),
      ],
      edges: [{ id: 'e1', from: 'osc-old', to: 'target' }],
    };
    const migrated = splitModulationSourceNodes(graph);
    expect(migrated.nodes.find((n) => n.id === 'midi')?.kind).toBe('cc');
    const osc = migrated.nodes.find((n) => n.id === 'osc-old')!;
    expect(osc.kind).toBe('osc');
    expect(osc.oscAddress).toBe('/fader/1');
    expect(migrated.edges[0]!.from).toBe('osc-old');
  });
});

describe('distinct modulation source nodes', () => {
  it('seeds note, osc and random source defaults and resolves their ModSource shapes', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('sources');
    const note = store.addNode('note', 0, 0)!;
    const osc = store.addNode('osc', 0, 100)!;
    const random = store.addNode('randomMod', 0, 200)!;

    store.setNoteNodeNumber(note, 64);
    store.setNoteNodeChannel(note, 3);
    store.setNoteNodeMode(note, 'velocity');
    store.setNoteNodeReleaseMs(note, 120);
    store.setOscNodeAddress(osc, ' /x ');
    store.setRandomDistribution(random, 'stepped');
    store.setRandomSteps(random, 8);

    expect(voice.nodeModSource(note)).toEqual({ kind: 'note', note: 64, channel: 3, mode: 'velocity', releaseMs: 120 });
    expect(voice.nodeModSource(osc)).toEqual({ kind: 'osc', address: '/x' });
    expect(voice.nodeModSource(random)).toEqual({ kind: 'random', value: 0, distribution: 'stepped', steps: 8 });
  });
});
