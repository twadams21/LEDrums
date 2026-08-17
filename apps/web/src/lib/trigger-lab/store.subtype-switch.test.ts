import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';
import { listModifiers } from '@ledrums/core';

/* Store-level acceptance for F3 item 11 — re-typing a node's SUBTYPE in place, the inspector
   companion to the flat Add-node menu. The property that matters: a node keeps its identity
   (id, position, and the wires the new subtype can still carry) instead of being deleted and
   re-added, and the swap runs through the SAME path the equivalent add/pick uses. */

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

/** The store hands back RAW node objects from addNode — re-resolve through the graph before
    asserting on live state (the `$state` proxy gotcha recorded in ROUTER). */
const live = (store: TriggerLab, id: string): GraphNode =>
  store.selectedGraph!.nodes.find((n) => n.id === id)!;

function fresh(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  return store;
}

describe('effect node — re-typed to another collection', () => {
  it('lands on that collection with a real effect, keeping its id and position', () => {
    const store = fresh();
    const play = store.addNode('play', 120, 240)!;
    const target = store.selectableEffects.find((e) => !e.deprecated && e.playType === 'hits')!;

    store.setPlayCollection(live(store, play.id), 'hits');

    const after = live(store, play.id);
    expect(store.playCollectionOf(after)).toBe('hits');
    expect(store.effectOf(after)?.playType).toBe('hits');
    expect(after.effectId).toBe(target.id);
    // identity survives: this is a re-type, not a delete-and-re-add
    expect(after.id).toBe(play.id);
    expect([after.x, after.y]).toEqual([120, 240]);
  });

  it('resets params to the new effect the way a gallery swap does — one path, not two', () => {
    const store = fresh();
    const play = store.addNode('play', 0, 0)!;
    store.setPlayCollection(live(store, play.id), 'hits');
    const viaSwitch = { ...live(store, play.id).params };

    const other = store.addNode('play', 0, 100)!;
    store.pickEffect(live(store, other.id), live(store, play.id).effectId!);

    expect(viaSwitch).toEqual(live(store, other.id).params);
    expect(live(store, play.id).presetId).toBe(live(store, other.id).presetId);
  });

  it('is a no-op on the collection the node is already in', () => {
    const store = fresh();
    const play = store.addNode('play', 0, 0)!;
    const before = store.playCollectionOf(live(store, play.id));
    const effectId = live(store, play.id).effectId;

    store.setPlayCollection(live(store, play.id), before);

    expect(live(store, play.id).effectId).toBe(effectId);
  });

  it('refuses to re-type a node that is not an effect node', () => {
    const store = fresh();
    const delay = store.addNode('delay', 0, 0)!;
    store.setPlayCollection(live(store, delay.id), 'hits');
    expect(live(store, delay.id).kind).toBe('delay');
  });
});

describe('modulation source — re-typed to another source kind', () => {
  it('keeps the wires it modulates: a param wire is valid for every source kind', () => {
    const store = fresh();
    const play = store.addNode('play', 300, 0)!;
    const lfo = store.addNode('lfo', 0, 0)!;
    const key = store.faceParamSpecs(live(store, play.id)).find((s) => s.kind === 'number')!.key;
    store.addFaceParam(live(store, play.id), key);
    store.connect(lfo.id, play.id, undefined, `param:${key}`);
    expect(store.mappingsFor(live(store, play.id), key)).toHaveLength(1);

    store.changeKind(live(store, lfo.id), 'envelope');

    expect(live(store, lfo.id).kind).toBe('envelope');
    expect(store.mappingsFor(live(store, play.id), key)).toHaveLength(1);
  });

  it('seeds the new kind its own defaults', () => {
    const store = fresh();
    const cc = store.addNode('cc', 0, 0)!;
    store.changeKind(live(store, cc.id), 'randomMod');
    const after = live(store, cc.id);
    expect(after.kind).toBe('randomMod');
    expect(after.randomDistribution).toBe('linear');
    expect(after.randomSteps).toBe(4);
  });
});

describe('modifier node — re-typed to another modifier', () => {
  it('reseeds the new modifier’s declared params and drops the old envelopes', () => {
    const store = fresh();
    const mod = store.addNode('modifier', 0, 0)!;
    const first = live(store, mod.id).modifierId!;
    // whatever a fresh modifier node seeds, switch to a DIFFERENT registry entry
    const next = listModifiers().find((m) => m.id !== first)!;

    store.setModifierId(live(store, mod.id), next.id);

    const after = live(store, mod.id);
    expect(after.modifierId).toBe(next.id);
    expect(after.env).toEqual({});
    expect(Object.keys(after.params).sort()).toEqual(next.paramSpec.map((p) => p.key).sort());
  });
});
