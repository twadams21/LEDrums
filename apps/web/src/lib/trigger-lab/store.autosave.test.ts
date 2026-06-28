// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { SHOWS_STORAGE_KEY } from './persistence';
import type { WSClient } from '../ws/client';

/* Repro: a node move (a DEEP graph mutation) MUST be autosaved. The existing persistence
   tests only cover hydration (construction) and never arm the autosave, so the save-on-edit
   path is untested. jsdom gives an effect scheduler flushSync can drive; we install a full
   localStorage mock (jsdom's stub here lacks removeItem/clear). */

class MemStorage {
  m = new Map<string, string>();
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

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

function savedNode(key: string, nodeId: string): { x: number; y: number } | undefined {
  const raw = localStorage.getItem(SHOWS_STORAGE_KEY);
  if (!raw) return undefined;
  const lib = JSON.parse(raw);
  const show = lib.data.shows[lib.data.activeShowId];
  return show?.authored?.graphs?.[key]?.nodes?.find((n: { id: string }) => n.id === nodeId);
}

describe('TriggerLab autosave (save on edit)', () => {
  it('serializes a node move into the saved blob (synchronous flush)', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    const key = store.selectedPadKey!;
    const node = store.graphs[key]!.nodes[0]!;
    store.moveNode(node, 1234, 5678);
    ax.stopAutosave(); // synchronous flush of currentLibrary()
    expect(savedNode(key, node.id)).toMatchObject({ x: 1234, y: 5678 });
  });

  it('reactively autosaves a node move (deep-mutation tracking)', () => {
    const store = new TriggerLab(fakeClient);
    (store as unknown as { startAutosave(): void }).startAutosave();
    flushSync();
    vi.advanceTimersByTime(500);

    const key = store.selectedPadKey!;
    const node = store.graphs[key]!.nodes[0]!;
    store.moveNode(node, 4321, 8765);
    flushSync();
    vi.advanceTimersByTime(500);

    expect(savedNode(key, node.id)).toMatchObject({ x: 4321, y: 8765 });
  });
});
