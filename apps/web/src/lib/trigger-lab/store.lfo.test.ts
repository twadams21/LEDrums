import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, type GraphEdge, type GraphNode, type TriggerCtx, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

/* S36 — LFO source node (web store + offline sim). Store side: addNode seeds default settings,
   setLfo patches them (kind-guarded, round-trips). Sim side: an LFO wired to a play param resolves
   onto the spawned voice's `modulations` and animates the param CONTINUOUSLY off absolute frame
   time — a looped voice keeps moving as time advances (it never phase-locks to the voice life, the
   way an envelope does). Companion to the engine-seam goldens in core (modulation-lfo.test.ts). */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
const fakeClient = () => ({ on() {}, connect() {}, close() {}, send() {} }) as never;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function withLfo(): { store: TriggerLab; play: GraphNode; lfo: GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const play = store.addNode('play', 200, 0)!; // seeds effect 'gen:chase-bands' (hue/brightness/…)
  const lfo = store.addNode('lfo', 0, 100)!;
  return { store, play, lfo };
}

describe('addNode(lfo)', () => {
  it('seeds a modulation-source node with default LFO settings', () => {
    const { store, lfo } = withLfo();
    expect(lfo.kind).toBe('lfo');
    expect(store.lfoSettings(lfo)).toEqual(voice.defaultLfoSettings());
    expect(voice.isModSourceKind('lfo')).toBe(true);
  });

  it('seeds approved waveform presets', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('test');
    const square = store.addNode('lfo', 0, 0, { lfoWaveform: 'square' })!;
    const sampleHold = store.addNode('lfo', 0, 100, { lfoWaveform: 'sample-hold' })!;
    expect(store.lfoSettings(square).waveform).toBe('square');
    expect(store.lfoSettings(sampleHold).waveform).toBe('sample-hold');
  });
});

describe('setLfo', () => {
  it('patches settings and round-trips through lfoSettings', () => {
    const { store, lfo } = withLfo();
    store.setLfo(lfo, { waveform: 'square', rateMode: 'beats', division: 'dotted-1/8' });
    expect(store.lfoSettings(lfo)).toMatchObject({
      waveform: 'square',
      rateMode: 'beats',
      division: 'dotted-1/8',
    });
  });

  it('partial patches preserve untouched fields', () => {
    const { store, lfo } = withLfo();
    store.setLfo(lfo, { rateHz: 4 });
    expect(store.lfoSettings(lfo)).toMatchObject({ waveform: 'sine', rateHz: 4 });
  });

  it('is a no-op on a non-lfo node', () => {
    const { store, play } = withLfo();
    store.setLfo(play, { waveform: 'square' });
    expect(play.lfo).toBeUndefined();
  });
});

// ---- offline sim: continuous modulation off absolute time -------------------------

function freshSim(): Sim {
  return new Sim(BUSES.map((b) => ({ ...b })), [...EFFECTS], [...PRESETS]);
}
function ctx(): TriggerCtx {
  return { velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 };
}
const trigger = (): GraphNode => makeNode('trigger', 'trigger', 0, 0);
const playNode = (): GraphNode =>
  makeNode('play', 'p', 200, 0, { effectId: 'gen:solid-base', presetId: 'gen:solid-base:default', mode: 'loop', scope: 'kit' });
const lfoNode = (over: Partial<voice.LfoSettings> = {}): GraphNode =>
  makeNode('lfo', 'l', 0, 0, { lfo: { ...voice.defaultLfoSettings(), ...over } });
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });

/** trigger → play('gen:chase-bands') loop, with an LFO wired to the play node's `brightness` row. */
function lfoToBrightness(over: Partial<voice.LfoSettings> = {}): TriggerGraph {
  return {
    nodes: [trigger(), playNode(), lfoNode(over)],
    edges: [edge('flow', 'trigger', 'p'), edge('mod', 'l', 'p', { toPort: 'param:brightness' })],
  };
}

function totalRgb(buf: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]!;
  return s;
}
/** Fire, advance to `targetMs` in ~50ms steps, render, return total brightness. */
function renderAt(graph: TriggerGraph, targetMs: number): number {
  const lab = buildLabModel();
  const sim = freshSim();
  sim.triggerGraph('test', graph, ctx());
  let t = 0;
  while (t < targetMs) {
    sim.tick(50);
    t += 50;
  }
  const buf = new Uint8Array(lab.model.count * 3);
  renderFrame(buf, sim, lab);
  return totalRgb(buf);
}

describe('sim — LFO graph resolution + continuous modulation', () => {
  it('an LFO wired to a play param resolves onto the spawned voice as an lfo source', () => {
    const sim = freshSim();
    sim.triggerGraph('test', lfoToBrightness(), ctx());
    expect(sim.voices.length).toBe(1);
    const mods = sim.voices[0]!.modulations;
    expect(mods).toHaveLength(1);
    expect(mods![0]!.targetParam).toBe('brightness');
    expect(mods![0]!.source.kind).toBe('lfo');
  });

  it('modulates a looped voice continuously off frame time (saw ramps up then resets)', () => {
    // saw at 0.5 Hz → period 2000ms. Brightness tracks absolute frame time, not voice age.
    const g = () => lfoToBrightness({ waveform: 'saw', rateMode: 'hz', rateHz: 0.5 });
    const early = renderAt(g(), 200); // phase ~0.1
    const mid = renderAt(g(), 900); // phase ~0.45
    const late = renderAt(g(), 1800); // phase ~0.9
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
  });

  it('an LFO node does not fire as a trigger-flow child (inert source)', () => {
    const graph: TriggerGraph = {
      nodes: [trigger(), lfoNode(), playNode()],
      edges: [edge('e0', 'trigger', 'l'), edge('e1', 'l', 'p')],
    };
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx());
    expect(sim.voices.length).toBe(0);
  });
});

describe('source getters are null-safe (node-face preview lifecycle race, S38)', () => {
  // The node-face SignalFace rAF ticker samples through these getters via a reactive prop getter;
  // when the source node is deleted the ticker can fire ONE more frame with a now-null node. The
  // getters must degrade to defaults, not throw: a throw in the rAF loop (plus the former
  // self-referential colour $effect in NodeSignalPreview) froze Svelte's effect flush and killed
  // delegated onclick handlers app-wide. Regression guard for the null-deref half of that bug.
  it('return safe defaults for a null/undefined node instead of throwing', () => {
    const store = new TriggerLab(fakeClient);
    for (const bad of [null, undefined]) {
      const node = bad as unknown as GraphNode;
      expect(() => store.lfoSettings(node)).not.toThrow();
      expect(store.lfoSettings(node)).toEqual(voice.defaultLfoSettings());
      expect(store.envelopeNodeEnvelope(node)).toBeNull();
      expect(store.ccNodeLiveValue(node)).toBe(0);
      expect(store.ccNodeController(node)).toBe(1);
      expect(store.ccNodeChannel(node)).toBeNull();
    }
  });
});
