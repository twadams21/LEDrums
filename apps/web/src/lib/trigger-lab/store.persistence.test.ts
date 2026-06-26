import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { STORAGE_KEY, serializeAuthored, type AuthoredState } from './persistence';
import { makeNode, type EffectDef, type Preset } from './sim';
import { EFFECTS, PRESETS } from './fixtures';
import type { WSClient } from '../ws/client';

/* Integration: construction = "reload". Verifies the store hydrates the persisted
   authored slice before wiring (so a reload restores content), tolerates a bad
   blob, and that createGraph mints a persistable authored graph. The pure module's
   serialize/deserialize contract is covered separately in persistence.test.ts. */

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

// The store never connects in these tests (start() is not called), so a no-op client
// that satisfies the constructor's factory is enough.
const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

function seed(partial: Partial<AuthoredState>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(partial as AuthoredState)));
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('TriggerLab hydration (restore on reload)', () => {
  it('starts from the seed when storage is empty', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
    expect(Object.keys(store.graphNames)).toHaveLength(0);
  });

  it('restores persisted scalar fields on construction', () => {
    seed({ bpm: 97, velocity: 0.42, beatsPerBar: 3, selectedPadKey: 'kick:1' });
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(97);
    expect(store.velocity).toBeCloseTo(0.42);
    expect(store.beatsPerBar).toBe(3);
    expect(store.selectedPadKey).toBe('kick:1');
  });

  it('restores an authored graph + its label, surfaced in graphLibrary', () => {
    const g = { nodes: [makeNode('trigger', 'trigger')], edges: [] };
    seed({ graphs: { 'graph-x': g }, graphNames: { 'graph-x': 'My graph' } });
    const store = new TriggerLab(fakeClient);
    expect(store.graphs['graph-x']).toBeTruthy();
    expect(store.graphLabel('graph-x')).toBe('My graph');
    expect(store.graphLibrary.some((e) => e.key === 'graph-x' && e.label === 'My graph')).toBe(true);
  });

  it('restores persisted pane sizes', () => {
    seed({ paneSizes: { authorRailW: 300 } });
    const store = new TriggerLab(fakeClient);
    expect(store.paneSizes.authorRailW).toBe(300);
  });

  it('ignores a version-mismatched blob (seed stands, never wedges boot)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, data: { bpm: 1 } }));
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
  });

  it('ignores a malformed (non-JSON) blob', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json');
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
  });
});

describe('TriggerLab effects hydration (union, never replace)', () => {
  const userFx = (id: string): EffectDef => ({
    id,
    name: id,
    pattern: 'flash',
    busId: 'base',
    scope: 'kit',
    attackMs: 10,
    sustainMs: 0,
    releaseMs: 100,
    params: [],
  });

  it('surfaces new built-in effects even when the persisted blob predates them', () => {
    // A returning user's blob holds only a stale subset (no generator effects). The
    // union re-adds every CURRENT built-in, so the 41 generator effects still appear.
    seed({ effects: [userFx('swirl')] }); // 'swirl' is a built-in; the blob lacks gen:*
    const store = new TriggerLab(fakeClient);
    expect(store.effects).toHaveLength(EFFECTS.length);
    expect(store.effects.some((e) => e.id.startsWith('gen:'))).toBe(true);
  });

  it('preserves user-created effects across the union (and never duplicates built-ins)', () => {
    seed({ effects: [...EFFECTS, userFx('my-custom-fx')] });
    const store = new TriggerLab(fakeClient);
    expect(store.effects.some((e) => e.id === 'my-custom-fx')).toBe(true); // user effect kept
    expect(store.effects.some((e) => e.id.startsWith('gen:'))).toBe(true); // built-ins present
    expect(store.effects).toHaveLength(EFFECTS.length + 1); // built-ins de-duped, +1 user effect
  });
});

describe('TriggerLab presets hydration (union, never replace)', () => {
  it('re-adds built-in generator :default presets a stale blob lacks (so play nodes resolve)', () => {
    // A pre-generator blob persists only its own preset and none of the 41 generator
    // `<id>:default`s. The union re-adds every missing built-in, so swapping a play
    // node to a generator effect still resolves its Default preset (no blank sub /
    // frozen preview). Regression for the generator-effect swap bug.
    seed({ presets: [{ id: 'mine:default', name: 'mine', effectId: 'swirl', params: {} } as Preset] });
    const store = new TriggerLab(fakeClient);
    const genDefaults = store.presets.filter((p) => p.id.startsWith('gen:') && p.id.endsWith(':default'));
    expect(genDefaults.length).toBeGreaterThan(0); // generator Defaults restored
    expect(store.presets.some((p) => p.id === 'mine:default')).toBe(true); // user preset kept
  });

  it("keeps the user's edited built-in preset (persisted wins over the seed, no dup)", () => {
    const builtin = PRESETS.find((p) => p.id.endsWith(':default'))!;
    seed({ presets: [{ ...builtin, name: 'EDITED' }] });
    const store = new TriggerLab(fakeClient);
    expect(store.presets.find((p) => p.id === builtin.id)?.name).toBe('EDITED'); // edit preserved
    expect(store.presets).toHaveLength(PRESETS.length); // 1 edited + the rest re-added, de-duped
  });
});

describe('TriggerLab.createGraph', () => {
  it('mints a uniquely-keyed, auto-named, selected empty graph', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph();
    expect(store.graphs[key]).toBeTruthy();
    expect(store.selectedPadKey).toBe(key);
    expect(store.graphNames[key]).toBe('New graph 1');
    expect(store.graphs[key]!.nodes).toHaveLength(1);
    expect(store.graphs[key]!.nodes[0]!.kind).toBe('trigger');
  });

  it('uses the given name and auto-increments the default for the next', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.createGraph('Kick swell');
    const b = store.createGraph();
    expect(store.graphNames[a]).toBe('Kick swell');
    expect(store.graphNames[b]).toBe('New graph 1');
    expect(a).not.toBe(b);
  });
});
