// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/svelte';
import { defaultProject, type Project } from '@ledrums/core';
import { TriggerLab } from '../../../trigger-lab/store.svelte';
import type { GraphNode } from '../../../trigger-lab/sim';
import type { WSClient } from '../../../ws/client';
import SequenceNodeInspector from './SequenceNodeInspector.svelte';
import { zoneOptions } from '../patch-inspector';

/* The Sequence node's reset binding (Tim, 2026-09-27):
   1. MIDI couldn't be chosen: it proposed note 60, and on a kit whose zones sit on 60+ the binding
      guard refused it, so the Note field never appeared.
   2. Drum-zone reset listed the build-time demo pads' zones — a different, partial set per drum —
      instead of the zones declared in Settings.
   3. Four drums as segmented buttons ran off the dock, cutting "Tom 2" in half. */

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

/** Tim's kit: every drum has zones 0–4, each on its own note from 60 up (as on his rig). */
function timsProject(): Project {
  const project = defaultProject();
  const drums = project.kit.drums.map((d) => d.id);
  const midiNotes = drums.flatMap((drumId, d) => [0, 1, 2, 3, 4].map((slot) => ({ note: 60 + d * 6 + slot, drumId, slot })));
  return { ...project, inputMap: { ...project.inputMap, midiNotes, oscMap: [], zones: [] } };
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  document.body.innerHTML = '';
});

function setup(): { store: TriggerLab; node: () => GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.project = timsProject();
  const added = store.addNode('sequence', 200, 0)!;
  return { store, node: () => store.selectedGraph!.nodes.find((n) => n.id === added.id)! };
}
const view = (store: TriggerLab, node: GraphNode) => render(SequenceNodeInspector, { props: { store, node } });

describe('reset by MIDI', () => {
  it('starts on a note no zone uses, so the reset actually turns on', () => {
    const { store, node } = setup();
    const note = store.freeResetNote(node());
    const claimed = new Set(store.project!.inputMap.midiNotes.map((n) => n.note));
    expect(note).not.toBeNull();
    expect(claimed.has(note!)).toBe(false);
    expect(claimed.has(60)).toBe(true); // the old default is taken on this kit

    view(store, node()).getByText('MIDI').click();
    expect(node().resetSource).toEqual({ kind: 'midi', note });
  });

  it('then shows the Note field and Learn, and takes a typed free note', () => {
    const { store, node } = setup();
    store.setSequenceResetSource(node(), { kind: 'midi', note: store.freeResetNote(node())! });
    const screen = view(store, node());
    expect(screen.getByLabelText('Reset MIDI note')).toBeTruthy();
    expect(screen.getByLabelText('Learn reset MIDI note')).toBeTruthy();
    expect(store.setSequenceResetSource(node(), { kind: 'midi', note: 40 })).toBe(true);
    expect(node().resetSource).toEqual({ kind: 'midi', note: 40 });
  });

  it('still refuses a note a zone uses (a Drum reset is the way to share a pad)', () => {
    const { store, node } = setup();
    expect(store.setSequenceResetSource(node(), { kind: 'midi', note: 60 })).toBe(false);
  });
});

describe('reset by drum zone', () => {
  it('lists every drum of the kit, as a dropdown', () => {
    const { store, node } = setup();
    store.setSequenceResetSource(node(), { kind: 'drum', drumId: 'kick', zone: '0' });
    const screen = view(store, node());
    expect(screen.getByLabelText('Reset drum').tagName).not.toBe('DIV'); // a Select trigger, not a segment row
    expect(within(document.body).queryAllByRole('radio', { name: /Tom 2/ })).toHaveLength(0);
  });

  it('offers each drum exactly the zones Settings declares for it, by their names', () => {
    const { store, node } = setup();
    const map = store.project!.inputMap;
    for (const drum of store.project!.kit.drums) {
      const slots = map.midiNotes.filter((n) => n.drumId === drum.id).map((n) => String(n.slot));
      expect(zoneOptions(map, drum.id).map((o) => o.value), drum.id).toEqual(slots);
    }
    // The picker shows the zone by its Settings name, not the demo kit's.
    store.setSequenceResetSource(node(), { kind: 'drum', drumId: 'tom2', zone: '4' });
    const label = zoneOptions(map, 'tom2').find((o) => o.value === '4')!.label;
    expect(view(store, node()).getByLabelText('Reset zone').textContent).toContain(label);
  });
});
