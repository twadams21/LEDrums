// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { TriggerLab } from '../../trigger-lab/store.svelte';
import type { WSClient } from '../../ws/client';
import type { EffectRow as EffectRowVM, PresetRow as PresetRowVM, GraphRow as GraphRowVM } from './objects-view';
import SongRow from './SongRow.svelte';
import EffectRow from './EffectRow.svelte';
import GraphRow from './GraphRow.svelte';
import PresetRow from './PresetRow.svelte';

/* The Objects view's per-type rows now live in their own sub-components (S2.2). These cover the
   wiring that moved with them — the per-type CRUD surface and, critically, the preset delete-
   gating + effect non-deletability — by driving each row over a real store. Pure view-model
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

const presetVM = (over: Partial<PresetRowVM> = {}): PresetRowVM => ({
  id: 'swirl:wide',
  name: 'Wide',
  effectId: 'swirl',
  effectName: 'Swirl',
  usage: 0,
  isDefault: false,
  deletable: true,
  ...over,
});

describe('PresetRow — delete-gating', () => {
  it('enables Delete and calls the store when the preset is deletable', async () => {
    const store = new TriggerLab(fakeClient);
    const spy = vi.spyOn(store, 'deletePreset');
    const { getByLabelText } = render(PresetRow, { props: { store, preset: presetVM({ deletable: true }) } });
    const del = getByLabelText('Delete preset') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    await fireEvent.click(del);
    expect(spy).toHaveBeenCalledWith('swirl:wide');
  });

  it('disables Delete (with the in-use label) when the preset is not deletable', () => {
    const store = new TriggerLab(fakeClient);
    const { getByLabelText } = render(PresetRow, {
      props: { store, preset: presetVM({ deletable: false, usage: 2 }) },
    });
    // gated to the store guard: the in-use label + a disabled button (browser blocks the click)
    const del = getByLabelText('In use — can’t delete') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });
});

describe('EffectRow — foundational (rename + duplicate only)', () => {
  it('offers Duplicate but never a Delete affordance', () => {
    const store = new TriggerLab(fakeClient);
    const effect: EffectRowVM = { id: 'swirl', name: 'Swirl', presetCount: 2 };
    const { queryByLabelText } = render(EffectRow, { props: { store, effect } });
    expect(queryByLabelText('Duplicate effect')).not.toBeNull();
    expect(queryByLabelText('Delete effect')).toBeNull();
  });
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

describe('GraphRow', () => {
  it('opens the graph via the onOpen callback when the row is clicked', async () => {
    const store = new TriggerLab(fakeClient);
    const first = store.graphLibrary[0]!;
    const graph: GraphRowVM = { key: first.key, label: first.label };
    const onOpen = vi.fn();
    const { container } = render(GraphRow, { props: { store, graph, onOpen } });
    await fireEvent.click(container.querySelector('.li-main')!);
    expect(onOpen).toHaveBeenCalledWith(first.key);
  });
});
