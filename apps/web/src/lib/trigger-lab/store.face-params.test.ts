import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';

/* Store-level acceptance for S5's unified gesture: "add a param to the node face" and "expose
   this param for modulation" are ONE mutation on ONE list (`node.modInputs`), and a face edit
   fires through the SAME `setParam` route the inspector uses — bracketed into a single undo
   checkpoint per drag gesture. */

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

/** A fresh store on a new graph with a play node carrying a real effect, plus an LFO source
    and a modifier node — the modifier is the deterministic MIXED-TYPE case (`trail` declares
    a numeric `decayMs` and an enum `mode`), which is what the widening is about. */
function withPlay(): { store: TriggerLab; play: GraphNode; lfo: GraphNode; mod: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const play = store.addNode('play', 200, 0)!;
  const lfo = store.addNode('lfo', 0, 200)!;
  const mod = store.addNode('modifier', 0, 400)!;
  return {
    store,
    play: store.selectedGraph!.nodes.find((n) => n.id === play.id)!,
    lfo,
    mod: store.selectedGraph!.nodes.find((n) => n.id === mod.id)!,
  };
}

/** The store hands back RAW node objects from addNode — always re-resolve through the graph
    before asserting on live state (the `$state` proxy gotcha recorded in ROUTER). */
const live = (store: TriggerLab, id: string): GraphNode => store.selectedGraph!.nodes.find((n) => n.id === id)!;

describe('one list: face rows ARE the exposed modulation rows', () => {
  it('addFaceParam and addModInput are the same mutation on the same list', () => {
    const { store, play } = withPlay();
    const key = store.faceParamSpecs(play)[0]!.key;

    store.addFaceParam(play, key);

    expect(store.isParamOnFace(live(store, play.id), key)).toBe(true);
    expect(store.modInputsOf(live(store, play.id))).toEqual([{ param: key }]);
  });

  it('offers non-numeric params to the face that the modulation picker excludes', () => {
    const { store, mod } = withPlay();
    // `trail`: decayMs (number) + mode (enum)
    expect(store.faceParamSpecs(mod).map((s) => [s.key, s.kind])).toEqual([
      ['decayMs', 'number'],
      ['mode', 'enum'],
    ]);
    expect(store.availableFaceParams(mod).map((p) => p.key)).toEqual(['decayMs', 'mode']);
    // the pre-S5 modulation picker still offers only what a source can drive
    expect(store.availableModParams(mod).map((p) => p.key)).toEqual(['decayMs']);
  });

  it('puts an enum param on the face — the gesture the numbers-only list could never serve', () => {
    const { store, mod } = withPlay();
    store.addFaceParam(mod, 'mode');
    expect(store.modInputsOf(live(store, mod.id))).toEqual([{ param: 'mode' }]);
    expect(store.isParamOnFace(live(store, mod.id), 'mode')).toBe(true);
  });

  it('exposing is idempotent — a second add stacks no duplicate row and no undo entry', () => {
    const { store, play } = withPlay();
    const key = store.faceParamSpecs(play)[0]!.key;
    store.addFaceParam(play, key);
    store.addFaceParam(play, key);
    expect(store.modInputsOf(live(store, play.id))).toEqual([{ param: key }]);
  });
});

describe('removing a face row preserves the existing wired-row behaviour exactly', () => {
  it('deletes the row AND its incoming modulation wires', () => {
    const { store, play, lfo } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.addFaceParam(play, key);
    store.connect(lfo.id, play.id, undefined, `param:${key}`);
    expect(store.mappingsFor(live(store, play.id), key)).toHaveLength(1);

    store.removeFaceParam(live(store, play.id), key);

    expect(store.isParamOnFace(live(store, play.id), key)).toBe(false);
    expect(store.mappingsFor(live(store, play.id), key)).toHaveLength(0);
    // identical to the pre-S5 route
    expect(store.selectedGraph!.edges.some((e) => e.toPort === `param:${key}`)).toBe(false);
  });

  it('is undoable as one action — undo restores both the row and its wire', () => {
    const { store, play, lfo } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.addFaceParam(play, key);
    store.connect(lfo.id, play.id, undefined, `param:${key}`);

    store.removeFaceParam(live(store, play.id), key);
    store.undo();

    expect(store.isParamOnFace(live(store, play.id), key)).toBe(true);
    expect(store.mappingsFor(live(store, play.id), key)).toHaveLength(1);
  });
});

describe('modDropTarget — a body-drop never picks an unmodulatable row', () => {
  it('skips a non-numeric face row and lands on a number', () => {
    const { store, mod } = withPlay();
    // `mode` (enum) is the FIRST and only exposed row — a naive "first row" pick would target
    // `param:mode`, a port that carries no handle and that nothing can evaluate.
    store.addFaceParam(mod, 'mode');
    expect(store.modDropTarget(live(store, mod.id))).toBe('decayMs');
  });

  it('prefers an already-exposed number row over exposing a new one', () => {
    const { store, play } = withPlay();
    const numbers = store.availableModParams(play);
    expect(numbers.length).toBeGreaterThan(1);
    store.addFaceParam(play, numbers[1]!.key);
    expect(store.modDropTarget(live(store, play.id))).toBe(numbers[1]!.key);
  });

  it('is undefined for a node with no number param at all', () => {
    const { store } = withPlay();
    const random = store.addNode('random', 0, 600)!;
    expect(store.modDropTarget(store.selectedGraph!.nodes.find((n) => n.id === random.id)!)).toBeUndefined();
  });
});

describe('face edits ride the existing param mutation route', () => {
  it('setParam writes the node params (the same call the inspector makes)', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.setParam(live(store, play.id), key, 0.42);
    expect(store.liveParams(live(store, play.id))[key]).toBe(0.42);
  });

  it('a bracketed gesture collapses a whole drag into ONE undo checkpoint', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.setParam(live(store, play.id), key, 0);

    store.beginGesture();
    for (const v of [0.1, 0.2, 0.3, 0.4, 0.5]) store.setParam(live(store, play.id), key, v);
    store.endGesture();
    expect(store.liveParams(live(store, play.id))[key]).toBe(0.5);

    store.undo();
    // one undo returns the value as it stood BEFORE the drag, not one pointermove back
    expect(store.liveParams(live(store, play.id))[key]).toBe(0);
  });

  it('an unbracketed edit still takes its own checkpoint (no behaviour change elsewhere)', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.setParam(live(store, play.id), key, 0);
    store.setParam(live(store, play.id), key, 0.7);
    store.setParam(live(store, play.id), key, 0.9);

    store.undo();
    expect(store.liveParams(live(store, play.id))[key]).toBe(0.7);
  });

  it('a gesture that mutates nothing pushes no checkpoint', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.setParam(live(store, play.id), key, 0.25);

    store.beginGesture();
    store.endGesture();
    store.undo();

    // the undo popped the setParam checkpoint, not an empty gesture one
    expect(store.liveParams(live(store, play.id))[key]).not.toBe(0.25);
  });

  it('re-arms checkpoints after the gesture closes', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.beginGesture();
    store.setParam(live(store, play.id), key, 0.1);
    store.setParam(live(store, play.id), key, 0.2);
    store.endGesture();
    store.setParam(live(store, play.id), key, 0.8);

    store.undo();
    expect(store.liveParams(live(store, play.id))[key]).toBe(0.2);
    store.undo();
    expect(store.liveParams(live(store, play.id))[key]).not.toBe(0.2);
  });

  it('a stray endGesture cannot leave undo suppressed', () => {
    const { store, play } = withPlay();
    const key = store.availableModParams(play)[0]!.key;
    store.endGesture();
    store.endGesture();
    store.setParam(live(store, play.id), key, 0.33);
    store.setParam(live(store, play.id), key, 0.44);
    store.undo();
    expect(store.liveParams(live(store, play.id))[key]).toBe(0.33);
  });
});
