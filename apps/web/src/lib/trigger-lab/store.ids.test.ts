// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { effectChain } from '@ledrums/core';
import {
  SHOWS_V3_STORAGE_KEY,
  serializeShowLibraryV3,
  type AuthoredStateV3,
  type ShowLibraryV3,
} from './persistence';
import type { WSClient } from '../ws/client';

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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemStorage(),
    configurable: true,
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** Persist a v3 library whose generated ids all carry `suffix` (a number far above anything the
    id counter reaches in a test process), then reload from it. */
function persistLibrary(suffix: number): { sectionId: string; effectId: string } {
  const sectionId = `section-${suffix}`;
  const effectId = `fx-${suffix}`;
  const songId = `song-${suffix}`;
  const showId = `show-${suffix}`;
  const effect = effectChain.parseEffect({
    id: effectId,
    name: 'Reloaded',
    cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
    generator: { kind: 'solid', style: 'simple' },
    modifiers: [{ uid: `mod-${suffix}`, modifierId: 'strobe' }],
    controls: [{ uid: `ctl-${suffix}`, kind: 'lfo' }],
  });
  const authored = {
    songs: [{ id: songId, name: 'Song', sections: [{ id: sectionId, name: 'Section', effects: [effect], master: [] }] }],
    selectedCell: effect.cell,
    selectedEffectId: effectId,
    activeSongId: songId,
    activeSectionId: sectionId,
    bpm: 120,
    velocity: 0.85,
    beatsPerBar: 4,
  } as AuthoredStateV3;
  const lib: ShowLibraryV3 = { activeShowId: showId, shows: { [showId]: { id: showId, name: 'Reloaded Show', authored } } };
  localStorage.setItem(SHOWS_V3_STORAGE_KEY, JSON.stringify(serializeShowLibraryV3(lib)));
  return { sectionId, effectId };
}

const suffixOf = (id: string): number => Number(id.split('-').at(-1));

describe('TriggerLab persisted id reservation', () => {
  it('does not reuse a persisted Effect id after reload (the counter moves past it)', () => {
    const { effectId } = persistLibrary(9_000_000);
    const store = new TriggerLab(fakeClient);
    const added = store.addEffect({ row: 'snare', column: { kind: 'zone', slot: 0 } }, 'solid')!;
    expect(added).not.toBe(effectId);
    expect(suffixOf(added)).toBeGreaterThan(9_000_000);
  });

  it('does not reuse a persisted device uid after reload', () => {
    const { effectId } = persistLibrary(9_100_000);
    const store = new TriggerLab(fakeClient);
    const mod = store.addModifier(effectId, 'strobe')!;
    const ctl = store.addControl(effectId, 'lfo')!;
    expect(suffixOf(mod)).toBeGreaterThan(9_100_000);
    expect(suffixOf(ctl)).toBeGreaterThan(9_100_000);
  });

  it('does not reuse a persisted section id after reload', () => {
    const { sectionId } = persistLibrary(9_200_000);
    const store = new TriggerLab(fakeClient);
    store.copySection(sectionId);
    store.pasteSection();
    const ids = store.activeSong!.sections.map((s) => s.id);
    expect(ids).toContain(sectionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(suffixOf(ids.at(-1)!)).toBeGreaterThan(9_200_000);
  });
});
