// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/svelte';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from '../../trigger-lab/store.svelte';
import type { WSClient } from '../../ws/client';
import AddGraphDialog from './AddGraphDialog.svelte';

/* The Add-graph dialog as a place to sort and tidy the library: zones as headings (an empty zone
   offering Create), an A–Z switch, a delete on every row (unused = at once, used = confirm), and
   Remove duplicates. The list model and store verbs are tested on their own; this pins the wiring. */

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
});

function setup(prepare: (store: TriggerLab) => void = () => {}) {
  const store = new TriggerLab(fakeClient);
  store.project = defaultProject();
  prepare(store);
  const onAdded = vi.fn();
  const view = render(AddGraphDialog, { props: { store, section: store.activeSection, open: true, onClose: () => {}, onAdded } });
  return { store, onAdded, screen: within(document.body), view };
}

describe('AddGraphDialog — sorting', () => {
  it('heads the list with the kit’s zones, and offers A–Z', () => {
    const { store, screen } = setup();
    const first = store.drumZones[0]!;
    expect(screen.getByRole('heading', { name: new RegExp(first.title) })).toBeTruthy();
    expect(screen.getByText('A–Z')).toBeTruthy();
  });

  it('a zone with no graph offers Create, which makes one for that zone', () => {
    const { store, onAdded, screen } = setup((s) => {
      const zone = s.drumZones.at(-1)!;
      for (const key of Object.keys(s.graphs)) {
        const source = s.triggerSource(key);
        if (source?.kind === 'drum' && source.drumId === zone.drumId && source.zone === String(zone.slot)) s.deleteGraph(key);
      }
    });
    const zone = store.drumZones.at(-1)!;
    const create = vi.spyOn(store, 'createZoneGraphInSection');
    screen.getByTitle(`Create a graph for ${zone.title}`).click();
    expect(create).toHaveBeenCalledWith(store.activeSectionId, zone.drumId, zone.slot);
    expect(onAdded).toHaveBeenCalled();
  });
});

describe('AddGraphDialog — tidying', () => {
  it('deletes an unused graph at once', () => {
    let spare = '';
    const { store, screen } = setup((s) => {
      const placed = s.activeSection!.graphs[0]!;
      spare = s.copyGraphToSection(s.activeSectionId!, placed, 'Unused spare')!;
      s.removeGraphFromSection(s.activeSectionId!, spare);
    });
    screen.getByRole('button', { name: 'Delete “Unused spare” everywhere' }).click();
    expect(store.graphs[spare]).toBeUndefined();
  });

  it('asks before deleting a graph a section plays', async () => {
    const { store, screen } = setup();
    const placed = store.activeSection!.graphs[0]!;
    const label = store.graphLabel(placed);
    screen.getAllByRole('button', { name: `Delete “${label}” everywhere` })[0]!.click();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete everywhere' })).toBeTruthy());
    expect(store.graphs[placed]).toBeDefined(); // nothing deleted until confirmed
  });

  it('Remove duplicates counts the unused copies and removes them after confirming', async () => {
    const { store, screen } = setup((s) => {
      const placed = s.activeSection!.graphs[0]!;
      for (const name of ['Copy A', 'Copy B']) {
        const key = s.copyGraphToSection(s.activeSectionId!, placed, name)!;
        s.removeGraphFromSection(s.activeSectionId!, key);
      }
    });
    const count = store.redundantDuplicateGraphs.length;
    expect(count).toBeGreaterThanOrEqual(2);
    screen.getByRole('button', { name: `Remove duplicates (${count})` }).click();
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove duplicates' }).length).toBeGreaterThan(0));
    screen.getAllByRole('button', { name: 'Remove duplicates' }).at(-1)!.click();
    expect(store.redundantDuplicateGraphs).toEqual([]);
  });
});
