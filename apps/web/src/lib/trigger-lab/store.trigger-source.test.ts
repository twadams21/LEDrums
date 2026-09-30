import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { removeZone, setZoneLabel, setZoneMidiNote, setZoneOscAddress, zoneSlotsForDrum } from '../app/docks/patch-inspector';
import { sectionActions } from '../app/section-actions';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the trigger-source back-compat default + mutators (U1 T1).
   The pure sim tests can't reach hydrate: every pad-bound graph must gain an explicit
   `drum` source from its padKey on construction, idempotently, while authored graphs and
   already-explicit sources are left alone. */

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
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('trigger-source back-compat default (hydrate)', () => {
  it('gives every seeded pad graph an explicit drum source from its padKey', () => {
    const store = new TriggerLab(fakeClient);
    const entries = Object.entries(store.graphs);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, graph] of entries) {
      const trig = graph.nodes.find((n) => n.kind === 'trigger')!;
      expect(trig.source?.kind).toBe('drum');
      if (trig.source?.kind === 'drum') {
        const source = trig.source;
        expect(store.pads.some((pad) => pad.drumId === source.drumId && String(pad.zone) === source.zone)).toBe(true);
      }
    }
  });

  it('leaves an authored graph (createGraph) source unset — it is not pad-bound', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Authored');
    expect(store.triggerSource(key)).toBeUndefined();
  });
});

describe('trigger-source mutators', () => {
  it('setTriggerSource writes the source onto the graph trigger node', () => {
    const store = new TriggerLab(fakeClient);
    const key = store.createGraph('Authored');
    store.setTriggerSource(key, { kind: 'osc', address: '/kick' });
    expect(store.triggerSource(key)).toEqual({ kind: 'osc', address: '/kick' });
    // it lands on the actual trigger node inside `graphs`, so the authored autosave persists it
    const trig = store.graphs[key]!.nodes.find((n) => n.kind === 'trigger')!;
    expect(trig.source).toEqual({ kind: 'osc', address: '/kick' });
  });

  it('setTriggerSource can re-bind a pad graph from drum to midi', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    store.setTriggerSource(key, { kind: 'midi', cc: 7 });
    expect(store.triggerSource(key)).toEqual({ kind: 'midi', cc: 7 });
  });

  it('setTriggerSource is a no-op for an unknown graph key', () => {
    const store = new TriggerLab(fakeClient);
    expect(() => store.setTriggerSource('nope:0', { kind: 'osc', address: '/x' })).not.toThrow();
    expect(store.triggerSource('nope:0')).toBeUndefined();
  });
});

describe('drum zone graph authoring', () => {
  it('updates a default-format name even when it describes the wrong source, and undoes both', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    store.renameGraph(key, 'Kick • Center');
    const original = store.triggerSource(key);
    expect(store.setTriggerSource(key, { kind: 'drum', drumId: 'snare', zone: '1' })).toBe(true);
    expect(store.graphLabel(key).toLowerCase()).toBe('snare · edge');
    store.undo();
    expect(store.graphLabel(key)).toBe('Kick • Center');
    expect(store.triggerSource(key)).toEqual(original);
  });

  it('preserves a custom graph name', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    store.renameGraph(key, 'Verse lights');
    store.setTriggerSource(key, { kind: 'drum', drumId: 'snare', zone: '1' });
    expect(store.graphLabel(key)).toBe('Verse lights');
  });
});

describe('configured zones', () => {
  it('blocks removing a zone whose cell holds an Effect, in any section', () => {
    const store = new TriggerLab(fakeClient);
    store.project = defaultProject();
    const kick0 = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
    store.clearCell(kick0);
    store.setActiveSection('verse');
    store.addEffect(kick0, 'solid'); // an Effect in a section that is not the one on show
    store.setActiveSection('intro');
    const before = store.project.inputMap;
    expect(store.zoneGraphUsers('kick', 0)).toHaveLength(1);
    expect(store.setInputMap(removeZone(before, 'kick', 0))).toBe(false);
    expect(store.project.inputMap).toEqual(before);
    store.setActiveSection('verse');
    store.clearCell(kick0);
    expect(store.setInputMap(removeZone(before, 'kick', 0))).toBe(true);
    expect(zoneSlotsForDrum(store.project.inputMap, 'kick')).not.toContain(0);
  });

  it('uses configured zone labels and keeps default names current when a zone is renamed', () => {
    const store = new TriggerLab(fakeClient);
    store.project = defaultProject();
    const key = Object.keys(store.graphs)[0]!;
    store.renameGraph(key, 'Kick · center');
    store.setTriggerSource(key, { kind: 'drum', drumId: 'kick', zone: '0' });
    expect(store.setInputMap(setZoneLabel(store.project.inputMap, 'kick', 0, 'Head - edge'))).toBe(true);
    expect(store.graphLabel(key)).toBe('Kick · Head - edge');
    store.setTriggerSource(key, { kind: 'drum', drumId: 'snare', zone: '0' });
    expect(store.graphLabel(key)).toBe('Snare · center');
  });

  it('adds only missing configured sources, is idempotent and undoes as one transaction', () => {
    const store = new TriggerLab(fakeClient);
    store.project = defaultProject();
    const section = store.activeSection!;
    store.setSectionGraphs(section.id, []);
    const before = Object.keys(store.graphs);
    store.addMissingDrumZoneGraphs(section.id);
    const keys = [...store.activeSection!.graphs];
    const count = store.project.kit.drums.reduce((sum, drum) => sum + zoneSlotsForDrum(store.project!.inputMap, drum.id).length, 0);
    expect(keys).toHaveLength(count);
    expect(keys.every((key) => store.triggerSource(key)?.kind === 'drum')).toBe(true);
    store.addMissingDrumZoneGraphs(section.id);
    expect(store.activeSection!.graphs).toEqual(keys);
    store.undo();
    expect(store.activeSection!.graphs).toEqual([]);
    expect(Object.keys(store.graphs)).toEqual(before);
  });
});

describe('section menu actions', () => {
  it('moves in both directions and to both ends without changing the active section', () => {
    const store = new TriggerLab(fakeClient);
    const initial = store.activeSong!.sections.map((section) => section.id);
    const id = initial[0]!;
    const active = store.activeSectionId;
    const act = (label: string): void => {
      const action = sectionActions(store, id, () => {}).find((action) => action.label === label)!;
      expect(action.disabled).toBe(false);
      action.onSelect();
    };
    expect(sectionActions(store, id, () => {}).find((action) => action.label === 'Move left')?.disabled).toBe(true);
    act('Move right');
    expect(store.activeSong!.sections[1]!.id).toBe(id);
    act('Move left');
    expect(store.activeSong!.sections.map((section) => section.id)).toEqual(initial);
    act('Move to end');
    expect(store.activeSong!.sections.at(-1)!.id).toBe(id);
    expect(sectionActions(store, id, () => {}).find((action) => action.label === 'Move right')?.disabled).toBe(true);
    act('Move to start');
    expect(store.activeSong!.sections.map((section) => section.id)).toEqual(initial);
    expect(store.activeSectionId).toBe(active);
  });
});

describe('zone use outside the open show', () => {
  it('protects inactive shows and releases the zone once those Effects are deleted', () => {
    const store = new TriggerLab(fakeClient);
    store.project = defaultProject();
    const original = store.activeShowId;
    store.newShow('Second show');
    store.clearCell({ row: 'kick', column: { kind: 'zone', slot: 0 } }); // the open show no longer uses it
    const next = removeZone(store.project.inputMap, 'kick', 0);
    expect(store.setInputMap(next)).toBe(false);
    store.deleteShow(original);
    expect(store.setInputMap(next)).toBe(true);
  });

  it('protects an unreferenced canonical song library Effect', () => {
    const store = new TriggerLab(fakeClient);
    store.project = defaultProject();
    const libraryId = store.exportSongToLibrary(store.activeSongId)!;
    expect(libraryId).toBeTruthy();
    store.clearCell({ row: 'kick', column: { kind: 'zone', slot: 0 } });
    expect(store.setInputMap(removeZone(store.project.inputMap, 'kick', 0))).toBe(false);
    store.deleteLibrarySong(libraryId);
    expect(store.setInputMap(removeZone(store.project.inputMap, 'kick', 0))).toBe(true);
  });
});

it('allows unbinding a used legacy zone without deleting its identity', () => {
  const store = new TriggerLab(fakeClient);
  store.project = defaultProject();
  expect(store.setInputMap(setZoneMidiNote(store.project.inputMap, 'kick', 0, null))).toBe(true);
  expect(store.setInputMap(setZoneOscAddress(store.project.inputMap, 'kick', 0, null))).toBe(true);
  expect(zoneSlotsForDrum(store.project.inputMap, 'kick')).toContain(0);
  expect(store.zoneGraphUsers('kick', 0).length).toBeGreaterThan(0);
  expect(store.setInputMap(removeZone(store.project.inputMap, 'kick', 0))).toBe(false);
});
