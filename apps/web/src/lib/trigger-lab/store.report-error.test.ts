// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* Incident 09: the trigger-graph error boundaries surface faults on the Monitor as `error`
   events (the seam is store.reportError). A live-show fault must be visible in the timeline,
   not a silent blank canvas. */

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('TriggerLab.reportError → Monitor error event', () => {
  it('emits a Monitor `error` event carrying source / label / detail', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.monitorEvents.length;

    store.reportError('trigger-graph', 'connect', 'TypeError: boom');

    expect(store.monitorEvents.length).toBe(before + 1);
    const ev = store.monitorEvents[0]!; // appendMonitorEvent prepends the newest
    expect(ev.type).toBe('error');
    expect(ev.direction).toBe('local');
    expect(ev.source).toBe('trigger-graph');
    expect(ev.label).toBe('connect');
    expect(ev.detail).toBe('TypeError: boom');
  });

  it('surfaces the error through the Monitor `error` type filter', () => {
    const store = new TriggerLab(fakeClient);
    store.reportError('trigger-graph', 'projection', 'stack trace…');
    store.setMonitorTypeFilter('error');

    expect(
      store.visibleMonitorEvents.some((e) => e.source === 'trigger-graph' && e.label === 'projection'),
    ).toBe(true);
  });
});
