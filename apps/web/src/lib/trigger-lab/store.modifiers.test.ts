import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the S29 modifier-node authoring surface: addNode seeding,
   setModifierId / setModifierBypass, param editing on a modifier, and connect/reconnect
   carrying the `mod` target port with the modifier-scoping guard (mod wires only from a
   modifier node). */

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

/** A fresh store on a new authored graph, with a play + modifier node added. */
function withModifier(): { store: TriggerLab; play: GraphNode; mod: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const play = store.addNode('play', 200, 0)!;
  const mod = store.addNode('modifier', 100, 100)!;
  return { store, play, mod };
}

const edgesOf = (store: TriggerLab) => store.selectedGraph!.edges;

describe('addNode(modifier)', () => {
  it('seeds the first registered modifier + its default params', () => {
    const { mod } = withModifier();
    expect(mod.kind).toBe('modifier');
    expect(mod.modifierId).toBe('trail');
    // trail's paramSpec defaults (decayMs 250, mode add)
    expect(mod.params).toEqual({ decayMs: 250, mode: 'add' });
  });
});

describe('setModifierId / setModifierBypass', () => {
  it('re-seeds params when the modifier changes', () => {
    const { store, mod } = withModifier();
    store.setParam(mod, 'decayMs', 999);
    store.setModifierId(mod, 'trail'); // same id → no-op (params untouched)
    expect(mod.params.decayMs).toBe(999);
  });

  it('toggles bypass', () => {
    const { store, mod } = withModifier();
    expect(mod.bypass).toBeFalsy();
    store.setModifierBypass(mod, true);
    expect(mod.bypass).toBe(true);
    store.setModifierBypass(mod, false);
    expect(mod.bypass).toBe(false);
  });

  it('setModifierId is a no-op on a non-modifier node', () => {
    const { store, play } = withModifier();
    store.setModifierId(play, 'trail');
    expect(play.modifierId).toBeFalsy();
  });
});

describe('setParam on a modifier node', () => {
  it('writes directly into the modifier node params', () => {
    const { store, mod } = withModifier();
    store.setParam(mod, 'decayMs', 1200);
    expect(mod.params.decayMs).toBe(1200);
  });
});

describe('connect / reconnect with a `mod` target port', () => {
  it('wires a modifier node into a play node mod input', () => {
    const { store, play, mod } = withModifier();
    store.connect(mod.id, play.id, undefined, 'mod');
    const e = edgesOf(store).find((x) => x.from === mod.id && x.to === play.id);
    expect(e?.toPort).toBe('mod');
  });

  it('rejects a mod wire from a non-modifier source (no edge added)', () => {
    const { store, play } = withModifier();
    const seq = store.addNode('sequence', 0, 50)!;
    const before = edgesOf(store).length;
    store.connect(seq.id, play.id, undefined, 'mod');
    expect(edgesOf(store).length).toBe(before); // rejected
  });

  it("rejects a modifier's output on a trigger-flow wire (no edge added)", () => {
    const { store, play, mod } = withModifier();
    const before = edgesOf(store).length;
    store.connect(mod.id, play.id); // flow wire (no toPort)
    expect(edgesOf(store).length).toBe(before);
  });

  it('reconnect carries the mod port through', () => {
    const { store, play, mod } = withModifier();
    const mod2 = store.addNode('modifier', 100, 200)!;
    store.connect(mod.id, play.id, undefined, 'mod');
    const e = edgesOf(store).find((x) => x.from === mod.id)!;
    // repoint the mod wire's source to mod2 (still a mod wire) — legal
    store.reconnect(e.id, mod2.id, play.id, undefined, 'mod');
    const moved = edgesOf(store).find((x) => x.id === e.id)!;
    expect(moved.from).toBe(mod2.id);
    expect(moved.toPort).toBe('mod');
  });
});
