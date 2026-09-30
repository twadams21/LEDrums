import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { makeNode, type TriggerGraph } from './sim';
import { STORAGE_KEY, VERSION } from './persistence';
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

/** A legacy (unversioned, pre-Gen3) authored blob with one unwired `play` leaf per graph — the
    exact shape that forces a migration + auto-wire on load. */
function legacyGraph(): TriggerGraph {
  return {
    nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' })],
    edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
  };
}

function seedLegacyBlob(graphs: Record<string, TriggerGraph>): void {
  const storage = new MemStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, data: { graphs } }));
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
