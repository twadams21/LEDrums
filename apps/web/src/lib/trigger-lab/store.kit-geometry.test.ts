// @vitest-environment jsdom
/* The store reports the project kit's geometry to the Effects strip (StripKitInfo): hoop counts
   (Target hoop picking, a Splice's THROUGH DRUM order) and bounds (a Slice's Space box). Before,
   no host reported them, so hoop picking and hoop orders silently fell back to one hoop. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

it('reports each drum’s hoop count and the kit’s bounds', () => {
  const store = new TriggerLab(() => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient);
  const drum = store.gridRows.find((r) => r.id !== 'kit')!;
  expect(store.drumHoopCount(drum.id)).toBeGreaterThan(0);
  expect(store.drumHoopCount('no-such-drum')).toBe(0);
  const { min, max } = store.kitBounds();
  expect(max.x).toBeGreaterThan(min.x);
});
