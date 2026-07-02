import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { deserializeAuthored, serializeAuthored, type AuthoredState } from './persistence';
import { makeNode, type TriggerGraph } from './sim';
import type { WSClient } from '../ws/client';

/* S18 — enum params end-to-end (authoring + persistence half; the engine half lives in
   packages/core/.../enum-params.test.ts). Proves an enum param is exposed as a Select-shaped
   spec, is editable through the store, and survives the persistence round-trip. */

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

describe('enum params — authoring (render + edit)', () => {
  it('exposes the radial-wash mode as an enum spec so the inspector renders a Select', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('t');
    const node = store.addNode('play', 0, 0)!;
    store.pickEffect(node, 'gen:radial-wash');

    expect(store.effectOf(node)?.id).toBe('gen:radial-wash');
    const modeSpec = store.effectOf(node)!.params.find((p) => p.key === 'mode')!;
    expect(modeSpec.kind).toBe('enum');
    expect(modeSpec.options).toEqual(['out', 'in', 'bounce']);
    // The default preset seeds the generator's own default enum value.
    expect(store.liveParams(node).mode).toBe('out');
  });

  it('setParam edits the enum value; liveParams reflects the choice', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('t');
    const node = store.addNode('play', 0, 0)!;
    store.pickEffect(node, 'gen:radial-wash');

    store.setParam(node, 'mode', 'in');
    expect(store.liveParams(node).mode).toBe('in');

    store.setParam(node, 'mode', 'bounce');
    expect(store.liveParams(node).mode).toBe('bounce');
  });
});

describe('enum params — persistence round-trip', () => {
  const graphWithEnum = (): TriggerGraph => ({
    nodes: [
      makeNode('trigger', 'trigger'),
      makeNode('play', 'p1', 0, 0, {
        effectId: 'gen:radial-wash',
        params: { hue: 280, brightness: 0.9, mode: 'bounce' },
      }),
    ],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  });

  const authored = (): AuthoredState => ({
    graphs: { 'kick:1': graphWithEnum() },
    graphNames: {},
    songs: [],
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 120 }],
    presets: [],
    effects: [],
    selectedPadKey: 'kick:1',
    activeSongId: null,
    activeSectionId: null,
    bpm: 120,
    velocity: 0.8,
    beatsPerBar: 4,
  });

  it('preserves a play node enum param through serialize → JSON → deserialize', () => {
    const state = authored();
    const restored = deserializeAuthored(JSON.parse(JSON.stringify(serializeAuthored(state))));
    const play = restored?.graphs?.['kick:1']?.nodes.find((n) => n.id === 'p1');
    expect(play?.params.mode).toBe('bounce');
    // the graph (its play node's number + enum params) round-trips byte-for-byte — the
    // widened ParamValue drops nothing on the persistence path.
    expect(restored?.graphs?.['kick:1']).toEqual(state.graphs['kick:1']);
  });
});
