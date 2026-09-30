// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { SHOWS_V3_STORAGE_KEY, SONGS_V2_STORAGE_KEY } from './persistence';
import { MASTER_CELL } from './effects-api';
import { ShowsController } from './shows-controller.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import { defaultProject, type effectChain } from '@ledrums/core';

/* Repro: an authored edit (a DEEP document mutation — since effect chains, an Effect edit) MUST
   be autosaved. (Graph edits no longer persist: the graph runes are a transient sandbox.) The existing persistence
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

/** The persisted (v3) Effect of the active show's section, or undefined. */
function savedEffect(sectionId: string, effectId: string): effectChain.Effect | undefined {
  const raw = localStorage.getItem(SHOWS_V3_STORAGE_KEY);
  if (!raw) return undefined;
  const lib = JSON.parse(raw);
  const show = lib.data.shows[lib.data.activeShowId];
  for (const song of show?.authored?.songs ?? []) {
    for (const section of song.sections ?? []) {
      if (section.id === sectionId) return section.effects?.find((e: { id: string }) => e.id === effectId);
    }
  }
  return undefined;
}

/** The seed's active section + its first Effect (the demo kick). */
function seedEffect(store: TriggerLab): { sectionId: string; effectId: string } {
  const sectionId = store.activeSectionId!;
  const effectId = store.activeSection!.effects![0]!.id;
  return { sectionId, effectId };
}

describe('TriggerLab autosave (save on edit)', () => {
  it('serializes an Effect edit into the saved blob (synchronous flush)', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    const { sectionId, effectId } = seedEffect(store);
    store.setEffectOpacity(effectId, 0.25);
    ax.stopAutosave(); // synchronous flush of currentLibrary()
    expect(savedEffect(sectionId, effectId)?.opacity).toBe(0.25);
  });

  it('reactively autosaves an Effect edit (deep-mutation tracking)', () => {
    const store = new TriggerLab(fakeClient);
    (store as unknown as { startAutosave(): void }).startAutosave();
    flushSync();
    vi.advanceTimersByTime(500);

    const { sectionId, effectId } = seedEffect(store);
    store.setGeneratorParam(effectId, 'color', '#123456');
    flushSync();
    vi.advanceTimersByTime(500);

    expect(savedEffect(sectionId, effectId)?.generator.params.color).toBe('#123456');
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
      const { sectionId, effectId } = seedEffect(store);
      store.beginGesture();
      for (let x = 1; x <= 30; x++) {
        store.setEffectOpacity(effectId, x / 100);
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
      expect(savedEffect(sectionId, effectId)?.opacity).toBe(0.3);
    } finally { ax.stopAutosave(); }
  });

  it('unload captures the latest edit even before its effect schedules a timer', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500); // no timer pending
      const { sectionId, effectId } = seedEffect(store);
      store.renameEffect(effectId, 'Unload probe'); // intentionally no flushSync
      window.dispatchEvent(new Event('beforeunload'));
      expect(savedEffect(sectionId, effectId)?.name).toBe('Unload probe');
    } finally { ax.stopAutosave(); }
  });

  it('does not autosave or add history for Effect edits on a referenced (canonical) library song', () => {
    const store = new TriggerLab(fakeClient);
    const libraryId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const section = store.activeSong!.sections[0]!;
    expect(store.activeSectionId).toBe(section.id);
    const effect = section.effects![0]!;

    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void; history: { stats: { entries: number } } };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const beforeShows = localStorage.getItem(SHOWS_V3_STORAGE_KEY);
      const beforeSongs = localStorage.getItem(SONGS_V2_STORAGE_KEY);
      const beforeHistory = ax.history.stats.entries;

      expect(store.addEffect({ row: 'tom1', column: { kind: 'zone', slot: 0 } }, 'solid')).toBeNull();
      store.setEffectOpacity(effect.id, 0.1);
      store.renameEffect(effect.id, 'blocked');
      store.removeEffect(effect.id);
      store.addModifier(MASTER_CELL, 'strobe');
      store.clearCell(effect.cell);
      flushSync();
      vi.advanceTimersByTime(500);

      expect(localStorage.getItem(SHOWS_V3_STORAGE_KEY)).toBe(beforeShows);
      expect(localStorage.getItem(SONGS_V2_STORAGE_KEY)).toBe(beforeSongs);
      expect(ax.history.stats.entries).toBe(beforeHistory);
      expect(store.effectById(effect.id)).toEqual(effect);
      expect(store.undo()).toBe(false);
    } finally {
      ax.stopAutosave();
    }
  });

  it('tracks Effect add / remove and field changes, and disposes outgoing document subscriptions', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const sectionId = store.activeSectionId!;
      const added = store.addEffect({ row: 'tom1', column: { kind: 'zone', slot: 0 } }, 'solid')!;
      flushSync();
      vi.advanceTimersByTime(500);
      expect(savedEffect(sectionId, added)).toBeDefined();
      store.removeEffect(added);
      flushSync();
      vi.advanceTimersByTime(500);
      expect(savedEffect(sectionId, added)).toBeUndefined();
      const stale = store.activeSection!;
      store.newShow();
      flushSync();
      vi.advanceTimersByTime(500);
      const snapshots = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      stale.name = 'stale edit'; // a stale reference into the outgoing show: must not autosave
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
      const saved = JSON.parse(localStorage.getItem(SHOWS_V3_STORAGE_KEY)!).data;
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
    expect(JSON.parse(localStorage.getItem(SHOWS_V3_STORAGE_KEY)!).data.shows[store.activeShowId].authored.bpm).toBe(143);
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

  it('materializes once when connected, omits cached recall, and signature-skips no-ops', () => {
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
      store.setEffectOpacity(store.activeSection!.effects![0]!.id, 0.4);
      flushSync();
      expect(shows).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(shows).toHaveBeenCalledTimes(1);
      expect(songs).toHaveBeenCalledTimes(1);
      const pushed = sent.find((m) => m.t === 'setShowLibrary');
      expect(pushed?.t === 'setShowLibrary' && JSON.stringify(pushed.library)).toBe(localStorage.getItem(SHOWS_V3_STORAGE_KEY));
      expect(sent.map((m) => m.t)).toEqual(['setShow', 'setShowLibrary']);
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
      song.sections[0]!.effects[0]!.opacity = 0.123;
      flushSync();
      vi.advanceTimersByTime(500);
      expect(JSON.parse(localStorage.getItem(SONGS_V2_STORAGE_KEY)!).data.songs[id].sections[0].effects[0].opacity).toBe(0.123);
    } finally { ax.stopAutosave(); }
  });
});
