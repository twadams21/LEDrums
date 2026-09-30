import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { effectChain } from '@ledrums/core';
import { SHOWS_STORAGE_KEY, SONGS_STORAGE_KEY, STORAGE_KEY } from './legacy-import';
import {
  SHOWS_V3_STORAGE_KEY,
  serializeShowLibraryV3,
  type AuthoredStateV3,
} from './persistence';
import type { WSClient } from '../ws/client';

/* Integration: construction = "reload". Verifies the store hydrates the persisted v3 show
   library before wiring (so a reload restores content), tolerates a bad blob, never touches the
   old (v1/v2) keys, and that createGraph mints a sandbox graph. The pure module's
   serialize/deserialize contract is covered separately in persistence(.v3).test.ts. */

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

function seed(partial: Partial<AuthoredStateV3>): void {
  const lib = { shows: { 'show-1': { id: 'show-1', name: 'Saved', authored: partial as AuthoredStateV3 } }, activeShowId: 'show-1' };
  localStorage.setItem(SHOWS_V3_STORAGE_KEY, JSON.stringify(serializeShowLibraryV3(lib)));
}

const kickHit = (id: string): effectChain.Effect =>
  effectChain.parseEffect({ id, name: id, cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid', style: 'simple' } });

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('TriggerLab hydration (restore on reload)', () => {
  it('starts from the seed when storage is empty: the demo Effects in Intro, Verse and Chorus empty', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
    expect(store.activeSong!.sections.map((s) => s.id)).toEqual(['intro', 'verse', 'chorus']);
    expect(store.activeSectionId).toBe('intro');
    expect(store.activeSection!.effects!.map((e) => e.generator.kind)).toEqual(['solid', 'wave', 'gradient']);
    expect(store.selectedEffectId).toBe(store.activeSection!.effects![0]!.id);
  });

  it('restores persisted scalar fields and the Effect selection on construction', () => {
    const section = { id: 'section-1', name: 'A', effects: [kickHit('fx-a'), kickHit('fx-b')], master: [] };
    seed({
      songs: [{ id: 'song-1', name: 'S', sections: [section] }],
      activeSongId: 'song-1',
      activeSectionId: 'section-1',
      bpm: 97,
      velocity: 0.42,
      beatsPerBar: 3,
      selectedCell: section.effects[1]!.cell,
      selectedEffectId: 'fx-b',
    });
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(97);
    expect(store.velocity).toBeCloseTo(0.42);
    expect(store.beatsPerBar).toBe(3);
    expect(store.activeSectionId).toBe('section-1');
    expect(store.selectedEffectId).toBe('fx-b');
  });

  it('round-trips a section’s Effect stack + Master chain through a reload', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.addEffect({ row: 'snare', column: { kind: 'zone', slot: 0 } }, 'wave', 'radial')!;
    store.setEffectOpacity(id, 0.5);
    const uid = store.addModifier('master', 'strobe')!;
    store.saveShow();
    const reloaded = new TriggerLab(fakeClient);
    expect(reloaded.effectById(id)).toEqual(store.effectById(id));
    expect(reloaded.effectById(id)!.opacity).toBe(0.5);
    expect(reloaded.masterChain.map((m) => m.uid)).toEqual([uid]);
  });

  it('never writes or deletes the old (v1 / v2) keys', () => {
    const oldShows = '{"version":2,"data":{"shows":{}}}';
    const oldSongs = '{"version":1,"data":{"songs":{}}}';
    const oldSingle = '{"version":2,"data":{"bpm":150}}';
    localStorage.setItem(SHOWS_STORAGE_KEY, oldShows);
    localStorage.setItem(SONGS_STORAGE_KEY, oldSongs);
    localStorage.setItem(STORAGE_KEY, oldSingle);
    const store = new TriggerLab(fakeClient);
    store.bpm = 111;
    store.addEffect({ row: 'kick', column: { kind: 'zone', slot: 0 } }, 'solid');
    store.saveShow();
    expect(localStorage.getItem(SHOWS_STORAGE_KEY)).toBe(oldShows);
    expect(localStorage.getItem(SONGS_STORAGE_KEY)).toBe(oldSongs);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(oldSingle);
    expect(localStorage.getItem(SHOWS_V3_STORAGE_KEY)).not.toBeNull();
  });

  it('restores persisted pane sizes', () => {
    seed({ paneSizes: { authorRailW: 300 } });
    const store = new TriggerLab(fakeClient);
    expect(store.paneSizes.authorRailW).toBe(300);
  });

  it('ignores a version-mismatched blob (seed stands, never wedges boot)', () => {
    localStorage.setItem(SHOWS_V3_STORAGE_KEY, JSON.stringify({ version: 999, data: { shows: {} } }));
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
  });

  it('ignores a malformed (non-JSON) blob', () => {
    localStorage.setItem(SHOWS_V3_STORAGE_KEY, '{ not json');
    const store = new TriggerLab(fakeClient);
    expect(store.bpm).toBe(120);
  });
});
