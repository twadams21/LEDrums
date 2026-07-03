import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { makeNode, type TriggerGraph } from './sim';
import type { WSClient } from '../ws/client';

/* Objects CRUD on effects + presets (the Objects view consumes these):
     - effects: rename + duplicate ONLY (foundational — never deletable);
     - presets: rename + duplicate, plus delete gated to usage-count 0 (and never a live
       effect's `:default`).
   Each keeps the sim's registries in sync (so the live preview reflects the edit) and persists
   via the authored-state autosave — the persistence block verifies a start → mutate → stop →
   reconstruct "reload" round-trip, mirroring store.graphs.test.ts. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
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

/** Run a body with a no-op rAF so start()/stop() drive the real autosave in node. */
function withRaf(body: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    body();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

/** A standalone graph holding one play node bound to `presetId` (for usage / delete gating). */
function playGraph(nodeId: string, presetId: string): TriggerGraph {
  return { nodes: [makeNode('play', nodeId, 0, 0, { effectId: 'swirl', presetId })], edges: [] };
}

describe('renameEffect', () => {
  it('updates the name in the registry AND the sim (shared by reference)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameEffect('swirl', 'Whirl');
    expect(store.effects.find((e) => e.id === 'swirl')!.name).toBe('Whirl');
    expect(store.sim.effectName('swirl')).toBe('Whirl'); // live preview reflects it
  });

  it('ignores a blank rename (keeps the old name) and an unknown id (no throw)', () => {
    const store = new TriggerLab(fakeClient);
    store.renameEffect('swirl', 'Whirl');
    store.renameEffect('swirl', '   '); // blank → no-op
    store.renameEffect('nope', 'X'); // unknown → no-op
    expect(store.effects.find((e) => e.id === 'swirl')!.name).toBe('Whirl');
  });
});

describe('duplicateEffect', () => {
  it('clones under a fresh id named "<name> copy", registers it, and seeds its Default preset', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.effects.find((e) => e.id === 'swirl')!;
    const newId = store.duplicateEffect('swirl')!;

    expect(newId).not.toBe('swirl');
    const dup = store.effects.find((e) => e.id === newId)!;
    expect(dup.name).toBe('Swirl copy');
    expect(dup.pattern).toBe(src.pattern);
    expect(dup.params).toEqual(src.params); // same param specs
    expect(store.sim.effect(newId)).toBeDefined(); // registered with the sim

    const def = store.presetById(`${newId}:default`);
    expect(def).toBeDefined();
    expect(def!.effectId).toBe(newId);
    expect(store.sim.preset(`${newId}:default`)).toBeDefined();
  });

  it('preserves a generator-backed effect\'s generatorId (renders identically)', () => {
    const store = new TriggerLab(fakeClient);
    const gen = store.effects.find((e) => e.generatorId)!;
    const newId = store.duplicateEffect(gen.id)!;
    expect(store.effects.find((e) => e.id === newId)!.generatorId).toBe(gen.generatorId);
  });

  it('is independent — renaming the source does not touch the copy', () => {
    const store = new TriggerLab(fakeClient);
    const newId = store.duplicateEffect('swirl')!;
    store.renameEffect('swirl', 'Renamed Source');
    expect(store.effects.find((e) => e.id === newId)!.name).toBe('Swirl copy');
  });

  it('returns null for an unknown id (no new effect)', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.effects.length;
    expect(store.duplicateEffect('nope')).toBeNull();
    expect(store.effects).toHaveLength(before);
  });
});

describe('renamePreset', () => {
  it('updates the name in the registry AND the sim', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.presetById('swirl:wide')).toBeDefined(); // fixture sanity
    store.renamePreset('swirl:wide', 'Broad');
    expect(store.presetById('swirl:wide')!.name).toBe('Broad');
    expect(store.sim.preset('swirl:wide')!.name).toBe('Broad');
  });

  it('ignores a blank rename and an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    store.renamePreset('swirl:wide', 'Broad');
    store.renamePreset('swirl:wide', '  '); // blank → no-op
    store.renamePreset('nope', 'X'); // unknown → no-op
    expect(store.presetById('swirl:wide')!.name).toBe('Broad');
  });
});

describe('duplicatePreset', () => {
  it('clones under a fresh id named "<name> copy", same effect + independent params, registered', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.presetById('swirl:wide')!;
    const newId = store.duplicatePreset('swirl:wide')!;

    expect(newId).not.toBe('swirl:wide');
    const dup = store.presetById(newId)!;
    expect(dup.name).toBe('Wide copy');
    expect(dup.effectId).toBe(src.effectId);
    expect(dup.params).toEqual(src.params);
    expect(dup.params).not.toBe(src.params); // independent copy, not the same object
    expect(store.sim.preset(newId)).toBeDefined(); // registered with the sim
  });

  it('returns null for an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.presets.length;
    expect(store.duplicatePreset('nope')).toBeNull();
    expect(store.presets).toHaveLength(before);
  });
});

describe('presetUsageCount', () => {
  it('counts play nodes referencing a preset across every graph (0 when unused)', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.duplicatePreset('swirl:wide')!; // fresh preset → nothing references it
    expect(store.presetUsageCount(id)).toBe(0);

    // two play nodes in two separate graphs both carry it as provenance (count = both).
    store.graphs = {
      ...store.graphs,
      'graph-a': {
        nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 0, 0, { presetId: id })],
        edges: [],
      },
      'graph-b': { nodes: [makeNode('play', 'p2', 0, 0, { presetId: id })], edges: [] },
    };
    expect(store.presetUsageCount(id)).toBe(2);
  });
});

describe('deletePreset', () => {
  it('removes an unused, non-default preset from the registry AND the sim, returns true', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.duplicatePreset('swirl:wide')!; // unused, not a `:default`
    expect(store.presetUsageCount(id)).toBe(0);

    expect(store.deletePreset(id)).toBe(true);
    expect(store.presetById(id)).toBeUndefined();
    expect(store.sim.preset(id)).toBeUndefined();
  });

  it('refuses (returns false, no-op) when the preset is in use', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.duplicatePreset('swirl:wide')!;
    store.graphs = { ...store.graphs, 'graph-use': playGraph('p', id) };
    expect(store.presetUsageCount(id)).toBe(1);

    expect(store.deletePreset(id)).toBe(false);
    expect(store.presetById(id)).toBeDefined(); // still there
  });

  it("refuses a live effect's foundational `:default` even when unused", () => {
    const store = new TriggerLab(fakeClient);
    const fxId = store.duplicateEffect('swirl')!; // seeds `${fxId}:default`, referenced by nothing
    const def = `${fxId}:default`;
    expect(store.presetUsageCount(def)).toBe(0); // isolates the `:default` guard from the usage guard

    expect(store.deletePreset(def)).toBe(false);
    expect(store.presetById(def)).toBeDefined();
  });

  it('returns false for an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.deletePreset('nope:default')).toBe(false);
  });
});

describe('persistence (autosave → hydrate)', () => {
  it('persists effect/preset renames + duplicates + a delete across a reload', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();

      const fxId = store.duplicateEffect('swirl')!; // user effect
      store.renameEffect(fxId, 'My FX'); // rename a user effect → persists
      store.renameEffect('swirl', 'Whirl'); // rename a BUILT-IN effect → persists via unionEffects merge

      const pid = store.duplicatePreset('swirl:wide')!; // user preset
      store.renamePreset(pid, 'My Preset');

      const doomed = store.duplicatePreset('swirl:fast')!; // user preset, then deleted
      expect(store.deletePreset(doomed)).toBe(true);

      store.stop(); // flush authored slice → localStorage

      const reloaded = new TriggerLab(fakeClient); // a "reload" hydrates from storage
      expect(reloaded.effects.find((e) => e.id === fxId)?.name).toBe('My FX'); // user effect + rename
      expect(reloaded.effects.find((e) => e.id === 'swirl')?.name).toBe('Whirl'); // built-in rename survives
      expect(reloaded.presetById(`${fxId}:default`)).toBeDefined(); // duplicated effect's seeded Default
      expect(reloaded.presetById(pid)?.name).toBe('My Preset'); // user preset + rename
      expect(reloaded.presetById(doomed)).toBeUndefined(); // deleted user preset stays gone
    });
  });
});
