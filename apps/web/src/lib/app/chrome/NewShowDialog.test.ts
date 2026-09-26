// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/svelte';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from '../../trigger-lab/store.svelte';
import type { WSClient } from '../../ws/client';
import NewShowDialog from './NewShowDialog.svelte';
import ShowBrowser from './ShowBrowser.svelte';
import DrumZonesPane from '../settings/panes/DrumZonesPane.svelte';

/* The New show chooser (from the Show browser's New — never on startup), and the per-show switch in
   Settings › Drum trigger zones. What each choice builds is pinned in store.zone-template.test.ts. */

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

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function store(withProject = true): TriggerLab {
  const s = new TriggerLab(fakeClient);
  if (withProject) s.project = defaultProject();
  return s;
}
const screen = () => within(document.body);

describe('NewShowDialog', () => {
  it('From my trigger zones creates a zone show and reports back', () => {
    const s = store();
    const newShow = vi.spyOn(s, 'newShow');
    const onCreated = vi.fn();
    render(NewShowDialog, { props: { store: s, open: true, onClose: () => {}, onCreated } });
    screen().getByRole('button', { name: /From my trigger zones/ }).click();
    expect(newShow).toHaveBeenCalledWith(undefined, 'zones');
    expect(onCreated).toHaveBeenCalled();
  });

  it('Blank creates a blank show', () => {
    const s = store();
    const newShow = vi.spyOn(s, 'newShow');
    render(NewShowDialog, { props: { store: s, open: true, onClose: () => {}, onCreated: () => {} } });
    screen().getByRole('button', { name: /Blank/ }).click();
    expect(newShow).toHaveBeenCalledWith(undefined, 'blank');
  });

  it('the zone choice is off, and says why, when the kit declares no zones', () => {
    render(NewShowDialog, { props: { store: store(false), open: true, onClose: () => {}, onCreated: () => {} } });
    const zones = screen().getByRole('button', { name: /From my trigger zones/ }) as HTMLButtonElement;
    expect(zones.disabled).toBe(true);
    expect(zones.textContent).toContain('Settings › Drum trigger zones');
  });
});

describe('ShowBrowser → New', () => {
  it('asks what the show starts with instead of creating one straight away', async () => {
    const s = store();
    const newShow = vi.spyOn(s, 'newShow');
    render(ShowBrowser, { props: { store: s, open: true, onClose: () => {} } });
    screen().getByRole('button', { name: 'New' }).click();
    expect(newShow).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen().getByRole('button', { name: /From my trigger zones/ })).toBeTruthy());
  });
});

describe('Settings › Drum trigger zones', () => {
  it('the switch sets the show’s setting, and Add to existing sections fills them', () => {
    const s = store();
    const set = vi.spyOn(s, 'setAutoZoneGraphs');
    const fill = vi.spyOn(s, 'fillAllSectionsWithZoneGraphs').mockReturnValue(3);
    render(DrumZonesPane, { props: { store: s } });
    screen().getByRole('button', { name: 'A graph per zone in every new section' }).click();
    expect(set).toHaveBeenCalledWith(true);
    screen().getByRole('button', { name: 'Add to existing sections' }).click();
    expect(fill).toHaveBeenCalled();
  });
});
