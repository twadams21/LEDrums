import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';
import { voice } from '@ledrums/core';

/* Store-level coverage for the S34 modulation graph layer: envelope source node seeding,
   expose/un-expose param rows (removal deletes wires), connect baking a `param:<key>` edge's
   default mapping settings, per-mapping edits, and persistence round-trip of the new fields. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function withRaf(body: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    body();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

/** A fresh store on a new authored graph with a play node + an envelope source node. */
function withEnvelope(): { store: TriggerLab; key: string; play: GraphNode; env: GraphNode } {
  const store = new TriggerLab(fakeClient);
  const key = store.createGraph('test');
  const play = store.addNode('play', 200, 0)!; // seeds effect 'chase' (hue/brightness/speed/width)
  const env = store.addNode('envelope', 0, 100)!;
  return { store, key, play, env };
}

const edgesOf = (store: TriggerLab) => store.selectedGraph!.edges;

describe('addNode(envelope)', () => {
  it('seeds a modulation-source node carrying a default shape', () => {
    const { store, env } = withEnvelope();
    expect(env.kind).toBe('envelope');
    const shape = store.envelopeNodeEnvelope(env);
    expect(shape).not.toBeNull();
    expect(shape!.adsr).toBeDefined();
    expect(shape!.points.length).toBeGreaterThan(0);
  });

  it('seeds approved envelope creation presets as editable ADSR shapes', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('test');
    const pluck = store.addNode('envelope', 0, 0, { envelopePreset: 'pluck' })!;
    const swell = store.addNode('envelope', 0, 100, { envelopePreset: 'swell' })!;
    const gate = store.addNode('envelope', 0, 200, { envelopePreset: 'gate' })!;

    expect(store.envelopeNodeAdsr(pluck)).toMatchObject({ attack: 0.03, sustain: 0 });
    expect(store.envelopeNodeAdsr(swell)).toMatchObject({ attack: 0.62, sustain: 0.92 });
    expect(store.envelopeNodeAdsr(gate)).toMatchObject({ attack: 0.01, sustain: 1 });
  });

  it('editing the node shape regenerates its render curve (single source)', () => {
    const { store, env } = withEnvelope();
    store.setEnvelopeNodeAdsr(env, { ...store.envelopeNodeAdsr(env), attack: 0.5 });
    expect(store.envelopeNodeAdsr(env).attack).toBe(0.5);
    expect(store.envelopeNodeEnvelope(env)!.points.length).toBeGreaterThan(0);
  });
});

describe('exposed param rows', () => {
  it('lists numeric params as pickable and excludes non-numbers', () => {
    const { store, play } = withEnvelope();
    const keys = store.modTargetSpecs(play).map((s) => s.key);
    expect(keys).toContain('brightness');
    expect(keys).not.toContain('tempoSync'); // a bool param is not modulatable
  });

  it('addModInput exposes a param (idempotent) and availableModParams drops it', () => {
    const { store, play } = withEnvelope();
    store.addModInput(play, 'brightness');
    store.addModInput(play, 'brightness'); // idempotent
    expect(store.modInputsOf(play)).toEqual([{ param: 'brightness' }]);
    expect(store.availableModParams(play).some((p) => p.key === 'brightness')).toBe(false);
  });

  it('removeModInput un-exposes the row AND deletes its incoming wires', () => {
    const { store, play, env } = withEnvelope();
    store.addModInput(play, 'brightness');
    store.connect(env.id, play.id, undefined, 'param:brightness');
    expect(store.mappingsFor(play, 'brightness')).toHaveLength(1);
    store.removeModInput(play, 'brightness');
    expect(store.modInputsOf(play)).toEqual([]);
    expect(store.mappingsFor(play, 'brightness')).toHaveLength(0); // wire gone
    expect(edgesOf(store).some((e) => e.toPort === 'param:brightness')).toBe(false);
  });
});

describe('connect — modulation edge = one mapping', () => {
  it('bakes default settings from the target param spec (amount 1, no invert, spec range)', () => {
    const { store, play, env } = withEnvelope();
    store.addModInput(play, 'brightness');
    store.connect(env.id, play.id, undefined, 'param:brightness');
    const [m] = store.mappingsFor(play, 'brightness');
    expect(m).toMatchObject({ amount: 1, invert: false, rangeMin: 0, rangeMax: 1, toPort: 'param:brightness' });
  });

  it('per-mapping edits round-trip through the store mutators', () => {
    const { store, play, env } = withEnvelope();
    store.connect(env.id, play.id, undefined, 'param:brightness');
    const id = store.mappingsFor(play, 'brightness')[0]!.id;
    store.setMappingAmount(id, 0.4);
    store.setMappingInvert(id, true);
    store.setMappingRange(id, 0.1, 0.8);
    const [m] = store.mappingsFor(play, 'brightness');
    expect(m).toMatchObject({ amount: 0.4, invert: true, rangeMin: 0.1, rangeMax: 0.8 });
  });

  it('rejects a modulation wire from a non-source node (no edge added)', () => {
    const { store, play } = withEnvelope();
    const seq = store.addNode('sequence', 0, 50)!;
    const before = edgesOf(store).length;
    store.connect(seq.id, play.id, undefined, 'param:brightness');
    expect(edgesOf(store).length).toBe(before);
  });
});

describe('persistence round-trip', () => {
  it('modInputs, the envelope shape, and edited mapping settings survive save + reload', () => {
    let key = '';
    let playId = '';
    let envId = '';
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      key = store.createGraph('test');
      const play = store.addNode('play', 200, 0)!;
      const env = store.addNode('envelope', 0, 100)!;
      playId = play.id;
      envId = env.id;
      store.addModInput(play, 'brightness');
      store.connect(env.id, play.id, undefined, 'param:brightness');
      const mid = store.mappingsFor(play, 'brightness')[0]!.id;
      store.setMappingAmount(mid, 0.33);
      store.setMappingRange(mid, 0.2, 0.7);
      store.stop();
    });

    const reloaded = new TriggerLab(fakeClient);
    const g = reloaded.graphs[key]!;
    const play = g.nodes.find((n) => n.id === playId)!;
    const env = g.nodes.find((n) => n.id === envId)!;
    expect(play.modInputs).toEqual([{ param: 'brightness' }]);
    expect(env.env[voice.ENVELOPE_NODE_KEY]?.adsr).toBeDefined();
    const edge = g.edges.find((e) => e.toPort === 'param:brightness')!;
    expect(edge).toMatchObject({ amount: 0.33, rangeMin: 0.2, rangeMax: 0.7 });
  });
});
