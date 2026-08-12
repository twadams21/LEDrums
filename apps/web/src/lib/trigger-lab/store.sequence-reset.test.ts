import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, type TriggerCtx, type TriggerGraph } from './sim';
import { TriggerLab } from './store.svelte';
import { MidiController, type MidiControllerHost } from './midi-controller.svelte';
import { STORAGE_KEY, serializeAuthored, type AuthoredState } from './persistence';
import type { WSClient } from '../ws/client';

/* Web-side coverage for the contained sequence reset (issue #159): the sim's offline mirror of
   the engine's reset application, the `setSequenceResetSource` mutator, and the sequence-reset
   MIDI-learn target. Engine-level semantics live in core `engine.sequence-reset.test.ts`; both
   sides call the same core `reset-source` module, so these tests pin the wiring, not the sweep. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

// --- sim mirror --------------------------------------------------------------

const ctx: TriggerCtx = { velocity: 1, sectionIndex: 0, sectionCount: 1, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 };

/** trigger → sequence(reset: MIDI 61) → {A, B} — fired under its graph key like the store does. */
function sequenceGraph(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      makeNode('sequence', 'seq', 200, 0, { resetSource: { kind: 'midi', note: 61 } }),
      makeNode('play', 'a', 400, -40, { effectId: 'gen:chase-bands', presetId: 'chase:default' }),
      makeNode('play', 'b', 400, 40, { effectId: 'gen:pixel-accum', presetId: 'sparkle:default' }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'seq' },
      { id: 'e1', from: 'seq', to: 'a' },
      { id: 'e2', from: 'seq', to: 'b' },
    ],
  };
}

function mkSim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

describe('Sim.applySequenceResets (offline mirror)', () => {
  it('snaps a sequence fired under its graph key back to step 1', () => {
    const sim = mkSim();
    const graph = sequenceGraph();
    const playedEffect = (): string => sim.voices[sim.voices.length - 1]!.effectId;

    sim.triggerGraph('Graph G', graph, ctx, 'g');
    expect(playedEffect()).toBe('gen:chase-bands'); // step 1
    sim.triggerGraph('Graph G', graph, ctx, 'g');
    expect(playedEffect()).toBe('gen:pixel-accum'); // step 2

    const hits = sim.applySequenceResets({ g: graph }, { note: 61 });
    expect(hits).toEqual([{ graphKey: 'g', nodeId: 'seq' }]);

    sim.triggerGraph('Graph G', graph, ctx, 'g');
    expect(playedEffect()).toBe('gen:chase-bands'); // back to step 1, not wrapped
  });

  it('leaves the sequence alone for an unmatched input', () => {
    const sim = mkSim();
    const graph = sequenceGraph();
    sim.triggerGraph('Graph G', graph, ctx, 'g');
    expect(sim.applySequenceResets({ g: graph }, { note: 99 })).toEqual([]);
    sim.triggerGraph('Graph G', graph, ctx, 'g');
    expect(sim.voices[sim.voices.length - 1]!.effectId).toBe('gen:pixel-accum'); // still step 2
  });
});

// --- store mutator -----------------------------------------------------------

function withSequence(): { store: TriggerLab; seq: ReturnType<TriggerLab['addNode']> & object } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('g');
  const seq = store.addNode('sequence', 200, 0)!;
  return { store, seq };
}

describe('setSequenceResetSource', () => {
  it('binds drum, MIDI, and OSC sources, and clears via null', () => {
    const { store, seq } = withSequence();
    expect(seq.resetSource).toBeUndefined(); // unbound by default

    store.setSequenceResetSource(seq, { kind: 'drum', drumId: 'kick', zone: '0' });
    expect(seq.resetSource).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });

    store.setSequenceResetSource(seq, { kind: 'midi', note: 61 });
    expect(seq.resetSource).toEqual({ kind: 'midi', note: 61 });

    store.setSequenceResetSource(seq, { kind: 'osc', address: '/reset' });
    expect(seq.resetSource).toEqual({ kind: 'osc', address: '/reset' });

    store.setSequenceResetSource(seq, null);
    expect(seq.resetSource).toBeUndefined();
  });

  it('is a no-op on a non-sequence node', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('g');
    const all = store.addNode('all', 200, 0)!;
    store.setSequenceResetSource(all, { kind: 'midi', note: 61 });
    expect(all.resetSource).toBeUndefined();
  });

  it('is undoable', () => {
    const { store, seq } = withSequence();
    store.setSequenceResetSource(seq, { kind: 'midi', note: 61 });
    store.undo();
    const node = store.selectedGraph!.nodes.find((n) => n.id === seq.id)!;
    expect(node.resetSource).toBeUndefined();
  });

  it('survives a serialize → reload round-trip', () => {
    const { store, seq } = withSequence();
    store.setSequenceResetSource(seq, { kind: 'midi', note: 61 });
    const graphKey = store.selectedPadKey!;

    const slice: Partial<AuthoredState> = { graphs: store.graphs, graphNames: store.graphNames };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored(slice as AuthoredState)));
    const reloaded = new TriggerLab(fakeClient);

    const node = reloaded.graphs[graphKey]!.nodes.find((n) => n.kind === 'sequence')!;
    expect(node.resetSource).toEqual({ kind: 'midi', note: 61 });
  });
});

// --- MIDI learn --------------------------------------------------------------

function stubHost(over: Partial<MidiControllerHost> = {}): MidiControllerHost & { bound: Array<[string, unknown]> } {
  const bound: Array<[string, unknown]> = [];
  return {
    bound,
    isViewer: () => false,
    getInputMap: () => null,
    setInputMap: () => {},
    setTriggerSource: () => {},
    setSequenceResetSource: (nodeId, source) => bound.push([nodeId, source]),
    setGlobalControlBinding: () => {},
    selectedGraphNodes: () => undefined,
    ...over,
  };
}

describe('sequence-reset MIDI learn', () => {
  it('binds the next incoming note through the host mutator and disarms', () => {
    const host = stubHost();
    const midi = new MidiController(host);
    midi.startLearn({ kind: 'sequence-reset', nodeId: 'seq' });
    midi.applyNoteLearn(61);
    expect(host.bound).toEqual([['seq', { kind: 'midi', note: 61 }]]);
    expect(midi.learnTarget).toBeNull();
  });

  it('never arms for a viewer', () => {
    const host = stubHost({ isViewer: () => true });
    const midi = new MidiController(host);
    midi.startLearn({ kind: 'sequence-reset', nodeId: 'seq' });
    expect(midi.learnTarget).toBeNull();
    midi.applyNoteLearn(61);
    expect(host.bound).toEqual([]);
  });
});
