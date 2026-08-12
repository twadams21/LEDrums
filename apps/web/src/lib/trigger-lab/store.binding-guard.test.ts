import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { defaultProject } from '@ledrums/core';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

/* The binding guard, store half — the rule from `binding-claims` applied at the four
   mutation paths.

   The point of these tests is PARITY: typed values and Learn both land on the same store
   methods, so a rule proved here holds for both. What they assert is the refusal being
   TOTAL — the local state is unchanged AND nothing went to the server. A guard that
   blocks the optimistic write but still sends the message would desync the rig, which is
   worse than the collision it was trying to prevent. */

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

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function connected(sent: ClientMessage[]): TriggerLab {
  const store = new TriggerLab(capturing(sent));
  store.project = defaultProject();
  return store;
}

/** The first graph key + its sequence/trigger nodes, for the graph-side guards. */
function firstGraphKey(store: TriggerLab): string {
  return Object.keys(store.graphs)[0]!;
}

const inputMapMessages = (sent: ClientMessage[]): ClientMessage[] => sent.filter((m) => m.t === 'setInputMap');

describe('global control vs drum zone', () => {
  it('refuses a global note that a zone already owns, locally AND on the wire', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setInputMap({ ...store.project!.inputMap, midiNotes: [{ note: 60, drumId: 'kick', slot: 0 }] });
    const before = inputMapMessages(sent).length;

    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    expect(store.globalControls.nextSong).toBeUndefined();
    expect(inputMapMessages(sent)).toHaveLength(before); // nothing sent — no desync
  });

  it('refuses a zone note that a global already owns (the reverse direction)', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    const before = [...store.project!.inputMap.midiNotes];

    // Re-point the kit's first zone onto the globally-bound note.
    const zones = store.project!.inputMap.midiNotes.map((m, i) => (i === 0 ? { ...m, note: 60 } : m));
    store.setInputMap({ ...store.project!.inputMap, midiNotes: zones });

    expect(store.project!.inputMap.midiNotes).toEqual(before); // whole write refused
    expect(store.globalControls.nextSong).toEqual({ midiNote: 60 }); // the incumbent is untouched
  });

  it('allows a global note nothing else owns', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 101 });
    expect(store.globalControls.nextSong).toEqual({ midiNote: 101 });
  });

  it('lets an unrelated edit through even when the map already holds a collision', () => {
    const store = connected([]);
    store.setMidiChannel(10);
    expect(store.project!.inputMap.midiChannel).toBe(10);
  });
});

describe('global control uniqueness', () => {
  it('refuses a second global on the same note', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    store.setGlobalControlBinding('prevSong', { midiNote: 60 });

    expect(store.globalControls.prevSong).toBeUndefined();
    expect(store.globalControls.nextSong).toEqual({ midiNote: 60 });
  });

  it('refuses a second global on the same OSC address', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { oscAddress: '/go' });

    store.setGlobalControlBinding('prevSong', { oscAddress: '/go' });

    expect(store.globalControls.prevSong).toBeUndefined();
  });

  it('lets a control re-commit its own unchanged binding', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    expect(store.globalControls.nextSong).toEqual({ midiNote: 60 });
  });

  it('lets a control add a second field alongside its own note', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    store.setGlobalControlBinding('nextSong', { oscAddress: '/go' });
    expect(store.globalControls.nextSong).toEqual({ midiNote: 60, oscAddress: '/go' });
  });

  it('refuses CC 0 — reserved for section recall', () => {
    const store = connected([]);
    store.setGlobalControlBinding('masterBrightness', { midiCc: 0 });
    expect(store.globalControls.masterBrightness).toBeUndefined();
  });

  it('always allows clearing a binding', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    store.setGlobalControlBinding('nextSong', { midiNote: undefined });
    expect(store.globalControls.nextSong).toBeUndefined();
  });
});

describe('sequence reset vs the other groups', () => {
  it('refuses a reset note a global control owns', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    const node = { id: 'seq-guard-1', kind: 'sequence' as const, x: 0, y: 0, params: {} };
    store.graphs[key]!.nodes.push(node as never);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    store.setSequenceResetSource(store.graphs[key]!.nodes.at(-1)!, { kind: 'midi', note: 60 });

    expect(store.graphs[key]!.nodes.at(-1)!.resetSource).toBeUndefined();
  });

  it('refuses a global note a sequence reset owns (the reverse direction)', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.graphs[key]!.nodes.push({ id: 'seq-guard-2', kind: 'sequence', x: 0, y: 0, params: {} } as never);
    store.setSequenceResetSource(store.graphs[key]!.nodes.at(-1)!, { kind: 'midi', note: 61 });

    store.setGlobalControlBinding('nextSong', { midiNote: 61 });

    expect(store.globalControls.nextSong).toBeUndefined();
  });

  it('lets two sequence resets share a note', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.graphs[key]!.nodes.push({ id: 'seq-guard-3', kind: 'sequence', x: 0, y: 0, params: {} } as never);
    store.graphs[key]!.nodes.push({ id: 'seq-guard-4', kind: 'sequence', x: 0, y: 0, params: {} } as never);
    const nodes = store.graphs[key]!.nodes;

    store.setSequenceResetSource(nodes.at(-2)!, { kind: 'midi', note: 62 });
    store.setSequenceResetSource(nodes.at(-1)!, { kind: 'midi', note: 62 });

    expect(nodes.at(-2)!.resetSource).toEqual({ kind: 'midi', note: 62 });
    expect(nodes.at(-1)!.resetSource).toEqual({ kind: 'midi', note: 62 });
  });

  it('allows a DRUM reset source even when that pad’s note is globally bound (issue #159)', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.graphs[key]!.nodes.push({ id: 'seq-guard-5', kind: 'sequence', x: 0, y: 0, params: {} } as never);
    store.setGlobalControlBinding('nextSong', { midiNote: 63 });

    // The drum namespace is untouched by the rule, so one pad can still both fire its
    // graph and reset this sequencer.
    store.setSequenceResetSource(store.graphs[key]!.nodes.at(-1)!, { kind: 'drum', drumId: 'kick', zone: '0' });

    expect(store.graphs[key]!.nodes.at(-1)!.resetSource).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
  });

  it('lets a reset re-commit its own note', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.graphs[key]!.nodes.push({ id: 'seq-guard-6', kind: 'sequence', x: 0, y: 0, params: {} } as never);
    const node = store.graphs[key]!.nodes.at(-1)!;

    store.setSequenceResetSource(node, { kind: 'midi', note: 64 });
    store.setSequenceResetSource(node, { kind: 'midi', note: 64 });

    expect(node.resetSource).toEqual({ kind: 'midi', note: 64 });
  });
});

describe('Learn survives a refusal', () => {
  /** Feed a heard note through the store's channel-gated MIDI input path. */
  function hearNote(store: TriggerLab, note: number): void {
    (store as unknown as { midi: { applyNoteLearn: (n: number) => void } }).midi.applyNoteLearn(note);
  }

  it('stays armed when the heard note is refused, and binds on the next free one', () => {
    const store = connected([]);
    const taken = store.project!.inputMap.midiNotes[0]!.note; // a zone note
    store.startMidiLearn({ kind: 'global-control', action: 'nextSong' });

    hearNote(store, taken);

    // Refused: nothing bound, and the arm is still live so the next pad can bind instead.
    expect(store.globalControls.nextSong).toBeUndefined();
    expect(store.midiLearnTarget).not.toBeNull();

    hearNote(store, 104);

    expect(store.globalControls.nextSong).toEqual({ midiNote: 104 });
    expect(store.midiLearnTarget).toBeNull();
  });

  it('disarms normally when the heard note is accepted', () => {
    const store = connected([]);
    store.startMidiLearn({ kind: 'global-control', action: 'nextSong' });

    hearNote(store, 105);

    expect(store.globalControls.nextSong).toEqual({ midiNote: 105 });
    expect(store.midiLearnTarget).toBeNull();
  });
});

describe('trigger source vs the other groups', () => {
  it('refuses a trigger source note a global control owns', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.setGlobalControlBinding('nextSong', { midiNote: 65 });

    store.setTriggerSource(key, { kind: 'midi', note: 65 });

    expect(store.graphs[key]!.nodes.find((n) => n.kind === 'trigger')?.source).not.toEqual({ kind: 'midi', note: 65 });
  });

  it('allows a trigger source note that only a drum zone owns — same group, shares by design', () => {
    const store = connected([]);
    const key = firstGraphKey(store);
    store.setInputMap({ ...store.project!.inputMap, midiNotes: [{ note: 66, drumId: 'kick', slot: 0 }] });

    store.setTriggerSource(key, { kind: 'midi', note: 66 });

    expect(store.graphs[key]!.nodes.find((n) => n.kind === 'trigger')?.source).toEqual({ kind: 'midi', note: 66 });
  });
});
