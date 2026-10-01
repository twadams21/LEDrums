import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { STORAGE_KEY } from './legacy-import';
import { toastStore } from '../ui/toast.svelte';
import type { WSClient } from '../ws/client';

/* R02 component seam (store ⇄ toast): a boot stays silent. Since effect chains an old (graph)
   library is no longer hydrated — so never migrated or auto-wired on load — it is offered for
   import instead. Drives the real store constructor + the shared
   toast store — the same path a returning user hits on load. */

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

/** A legacy (pre-Gen3) graph with one unwired `play` leaf — the exact shape the retired graph
    hydrate migrated and auto-wired on load, announcing it in a toast. */
function legacyGraph(): unknown {
  return {
    nodes: [{ id: 'trigger', kind: 'trigger', x: 0, y: 0 }, { id: 'p1', kind: 'play', x: 200, y: 0, effectId: 'gen:radial-wash' }],
    edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
  };
}

/** The old single authored blob (envelope v2) under its old key. */
function seedLegacyBlob(graphs: Record<string, unknown>): void {
  const storage = new MemStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, data: { graphs } }));
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
}

beforeEach(() => {
  toastStore.clear();
});
afterEach(() => {
  toastStore.clear();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('system-action toasts on load', () => {
  it('an old-format (graph) library at boot is left alone: no migration toast, an import offer instead', () => {
    seedLegacyBlob({ 'kick:0': legacyGraph() });

    const store = new TriggerLab(fakeClient);

    expect(toastStore.items).toHaveLength(0);
    expect(store.legacyImportAvailable).toBe(true);
  });


  it('stays silent on a fresh (already-Gen3) boot', () => {
    (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;

    new TriggerLab(fakeClient);

    expect(toastStore.items).toHaveLength(0);
  });
});
