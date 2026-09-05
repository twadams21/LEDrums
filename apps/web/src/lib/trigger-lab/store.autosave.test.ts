// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { SHOWS_STORAGE_KEY, SONGS_STORAGE_KEY } from './persistence';
import { ShowsController } from './shows-controller.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import { defaultProject } from '@ledrums/core';

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
  vi.restoreAllMocks();
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
    (store as unknown as { stopAutosave(): void }).stopAutosave();
  });

  it('materializes neither library during a drag, and only once each at flush', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      const songs = vi.spyOn(ShowsController.prototype, 'currentSongLibrary');
      const node = store.graphs[store.selectedPadKey!]!.nodes[0]!;
      store.beginGesture();
      for (let x = 1; x <= 30; x++) {
        store.moveNode(node, x, 42);
        flushSync();
      }
      store.endGesture();
      expect(store.saveStatus).toBe('saving');
      expect(shows).not.toHaveBeenCalled();
      expect(songs).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(shows).toHaveBeenCalledTimes(1);
      expect(songs).toHaveBeenCalledTimes(1);
      expect(store.saveStatus).toBe('saved');
      expect(savedNode(store.selectedPadKey!, node.id)).toMatchObject({ x: 30, y: 42 });
    } finally { ax.stopAutosave(); }
  });

  it('unload captures the latest deep edit even before its effect schedules a timer', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500); // no timer pending
      const node = store.graphs[store.selectedPadKey!]!.nodes[0]!;
      node.x = 999; // intentionally no flushSync
      window.dispatchEvent(new Event('beforeunload'));
      expect(savedNode(store.selectedPadKey!, node.id)?.x).toBe(999);
    } finally { ax.stopAutosave(); }
  });

  it('tracks optional field add/delete and array changes, and disposes outgoing graph subscriptions', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const key = store.selectedPadKey!;
      const graph = store.graphs[key]!;
      const node = graph.nodes[0]!;
      node.params.newValue = 23;
      graph.edges.push({ id: 'probe', from: node.id, to: 'output' });
      flushSync();
      vi.advanceTimersByTime(500);
      let saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.graphs[key];
      expect(saved.nodes[0].params.newValue).toBe(23);
      expect(saved.edges.at(-1).id).toBe('probe');
      delete node.params.newValue;
      graph.edges.pop();
      flushSync();
      vi.advanceTimersByTime(500);
      saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.graphs[key];
      expect(saved.nodes[0].params).not.toHaveProperty('newValue');
      expect(saved.edges.some((e: { id: string }) => e.id === 'probe')).toBe(false);
      store.newShow();
      flushSync();
      vi.advanceTimersByTime(500);
      const snapshots = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      node.x = 9999; // stale UI reference, its subscription must have been disposed
      flushSync();
      vi.advanceTimersByTime(500);
      expect(snapshots).not.toHaveBeenCalled();
    } finally { ax.stopAutosave(); }
  });

  it('flushes current and outgoing shows, never a captured pre-switch library', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const a = store.activeShowId;
      store.bpm = 177;
      flushSync();
      const b = store.newShow('B');
      store.bpm = 99;
      flushSync();
      vi.advanceTimersByTime(500);
      const saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data;
      expect(saved.activeShowId).toBe(b);
      expect(saved.shows[a].authored.bpm).toBe(177);
      expect(saved.shows[b].authored.bpm).toBe(99);
    } finally { ax.stopAutosave(); }
  });

  it('explicit Save flushes the latest revision immediately and observes the indicator floor', () => {
    const store = new TriggerLab(fakeClient);
    store.bpm = 143;
    const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
    store.saveShow();
    expect(shows).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.bpm).toBe(143);
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(149);
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(1);
    expect(store.saveStatus).toBe('saved');
    store.bpm = 144;
    store.saveShow();
    expect(store.saveStatus).toBe('saving');
  });

  it('does not claim Saved on a cache failure, and a later successful save recovers', () => {
    const store = new TriggerLab(fakeClient);
    store.saveShow(); // a successful flush still waiting on its 150 ms indicator floor
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    store.saveShow();
    vi.advanceTimersByTime(500);
    expect(store.saveStatus).toBe('idle');
    write.mockRestore();
    store.saveShow();
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(500);
    expect(store.saveStatus).toBe('saved');
  });

  it('materializes once when connected, sends the cached revision, and signature-skips no-ops', () => {
    let cb: WSCallbacks = {};
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(() => ({ on(callbacks: WSCallbacks) { cb = callbacks; }, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    store.start();
    try {
      cb.onConnection!('open');
      cb.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, null, null, null, { status: 'listening', port: 9000, hosts: [] });
      flushSync();
      vi.advanceTimersByTime(500);
      expect(store.saveStatus).toBe('idle'); // no initial mount blip
      sent.length = 0;
      const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      const songs = vi.spyOn(ShowsController.prototype, 'currentSongLibrary');
      store.graphs[store.selectedPadKey!]!.nodes[0]!.source = { kind: 'midi', note: 99 };
      flushSync();
      expect(shows).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(shows).toHaveBeenCalledTimes(1);
      expect(songs).toHaveBeenCalledTimes(1);
      const pushed = sent.find((m) => m.t === 'setShowLibrary');
      expect(pushed?.t === 'setShowLibrary' && JSON.stringify(pushed.library)).toBe(localStorage.getItem(SHOWS_STORAGE_KEY));
      expect(sent.map((m) => m.t)).toEqual(['setShow', 'recallSection', 'setShowLibrary']);
      sent.length = 0;
      store.saveShow();
      expect(sent).toEqual([]); // no-op signature guards still hold
      const previousPayload = JSON.stringify(pushed);
      store.newShow();
      store.bpm = 87;
      store.saveShow();
      expect(JSON.stringify(pushed)).toBe(previousPayload); // shared inactive slots never mutate
    } finally { store.stop(); vi.unstubAllGlobals(); }
  });

  it('tracks canonical song-library deep edits independently of the active show', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.exportSongToLibrary(store.activeSongId)!;
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const song = store.songLibrary.songs[id]!;
      const key = Object.keys(song.graphs)[0]!;
      song.graphs[key]!.nodes[0]!.x = 2468;
      flushSync();
      vi.advanceTimersByTime(500);
      expect(JSON.parse(localStorage.getItem(SONGS_STORAGE_KEY)!).data.songs[id].graphs[key].nodes[0].x).toBe(2468);
    } finally { ax.stopAutosave(); }
  });
});
