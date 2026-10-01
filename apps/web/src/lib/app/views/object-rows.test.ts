// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { TriggerLab } from '../../trigger-lab/store.svelte';
import type { WSClient } from '../../ws/client';
import SongRow from './SongRow.svelte';

/* The Objects view's per-type rows live in their own sub-components (S2.2). These cover the
   wiring that moved with them by driving each row over a real store. Pure view-model
   joins/sorting stay in objects-view.test.ts; layout parity is the owed live spot-check. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
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
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('SongRow', () => {
  it('marks the live song with a trailing status dot and activates on click', async () => {
    const store = new TriggerLab(fakeClient);
    const song = store.songs.find((s) => s.id === store.activeSongId)!;
    const spy = vi.spyOn(store, 'setActiveSong');
    const { container } = render(SongRow, { props: { store, song } });
    expect(container.querySelector('.li-trailing .dot')).not.toBeNull(); // active → dot
    await fireEvent.click(container.querySelector('.li-main')!);
    expect(spy).toHaveBeenCalledWith(song.id);
  });

  it('omits the status dot for a non-active song', () => {
    const store = new TriggerLab(fakeClient);
    const other = store.songs.find((s) => s.id !== store.activeSongId);
    const song = other ?? { ...store.songs[0]!, id: '__inactive__' };
    const { container } = render(SongRow, { props: { store, song } });
    expect(container.querySelector('.li-trailing .dot')).toBeNull();
  });
});
