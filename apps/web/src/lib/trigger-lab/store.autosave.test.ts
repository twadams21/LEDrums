// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { SHOWS_STORAGE_KEY, SONGS_STORAGE_KEY } from './persistence';
import type { WSClient } from '../ws/client';

/* Repro: a node move (a DEEP graph mutation) MUST be autosaved. The existing persistence
   tests only cover hydration (construction) and never arm the autosave, so the save-on-edit
   path is untested. jsdom gives an effect scheduler flushSync can drive; we install a full
   localStorage mock (jsdom's stub here lacks removeItem/clear). */

import { MemStorage, ThrowingStorage, quotaExceededError } from '../test-support/mem-storage';

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

/* resilience-hole-0007, part two: the indicator must stop claiming "Saved" over lost bytes.
   "Saved" means EVERY local write landed — not "at least one", which would still show green
   while the song library (the payload most likely to tip quota over) was silently dropped.
   A WS push is not evidence either: `client.send` is fire-and-forget with no ack. */
describe('TriggerLab autosave — the indicator tells the truth about local writes', () => {
  /** Arm autosave and burn the mount save, so the next edit is a real user save cycle. */
  function armed(): TriggerLab {
    const store = new TriggerLab(fakeClient);
    (store as unknown as { startAutosave(): void }).startAutosave();
    flushSync();
    vi.advanceTimersByTime(500);
    return store;
  }
  /** Make one authored edit and run it past the debounce + the min-visible-saving floor. */
  function edit(store: TriggerLab, x: number): void {
    const key = store.selectedPadKey!;
    const node = store.graphs[key]!.nodes[0]!;
    expect(() => {
      store.moveNode(node, x, x);
      flushSync();
      vi.advanceTimersByTime(500);
    }).not.toThrow(); // persistence must never throw out of the $effect
  }
  function useStorage(s: object): void {
    Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true });
  }

  it("says 'error', not 'saved', when BOTH local writes hit quota", () => {
    const store = armed();
    useStorage(new ThrowingStorage());
    edit(store, 111);
    expect(store.saveStatus).toBe('error');
    expect(store.saveError).toMatch(/show library/);
    expect(store.saveError).toMatch(/song library/); // both losses named, not just the first
  });

  it("says 'error' when ONLY the song-library write fails (the partial-loss case)", () => {
    const store = armed();
    useStorage(new ThrowingStorage(() => quotaExceededError(), (k) => k === SONGS_STORAGE_KEY));
    edit(store, 222);
    // The show library DID land — an "at least one write succeeded" rule would show 'saved' here
    // and quietly lose the songs. Every write has to land for the claim to be true.
    expect(localStorage.getItem(SHOWS_STORAGE_KEY)).toBeTruthy();
    expect(store.saveStatus).toBe('error');
    expect(store.saveError).toMatch(/song library/);
    expect(store.saveError).not.toMatch(/show library/);
  });

  it("says 'saved' when every local write lands", () => {
    const store = armed();
    edit(store, 333);
    expect(store.saveStatus).toBe('saved');
    expect(store.saveError).toBeNull();
  });

  it('records every failed write on the Monitor, even on the last-chance flush', () => {
    const store = armed();
    useStorage(new ThrowingStorage());
    const before = store.monitorEvents.length;
    (store as unknown as { stopAutosave(): void }).stopAutosave(); // no indicator left to show
    expect(store.monitorEvents.length).toBe(before + 2); // …but the loss is still traceable
    expect(store.monitorEvents[0]!.label).toMatch(/write failed/);
  });
});
