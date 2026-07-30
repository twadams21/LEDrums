import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { makeNode, type GraphEdge, type GraphNode, type TriggerGraph } from './sim';
import { evalPlays } from '../test-support/graph-eval';

/* S36 — LFO source node. Store side: addNode seeds default settings, setLfo patches them
   (kind-guarded, round-trips). Graph side: an LFO wired to a play param resolves onto the play
   action's `modulations`, and an LFO in the trigger FLOW is inert — both evaluated through the
   engine's evaluator (test-support/graph-eval).

   The third case here used to render the browser-side sim's pixels across 1800ms to prove the LFO
   tracks ABSOLUTE frame time rather than voice age. That renderer went with INIT-01 Decision 3;
   the claim is asserted against the real render path in core's modulation-lfo.test.ts, which this
   file was already described as the companion to. */

import { MemStorage } from '../test-support/mem-storage';
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
  const play = store.addNode('effect', 200, 0)!; // seeds effect 'gen:chase-bands' (hue/brightness/…)
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

// ---- graph resolution: an LFO reaches the play action as a modulation source ------

const trigger = (): GraphNode => makeNode('trigger', 'trigger', 0, 0);
const playNode = (): GraphNode =>
  makeNode('effect', 'p', 200, 0, { effectId: 'gen:solid-base', presetId: 'gen:solid-base:default', mode: 'loop', scope: 'kit' });
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

describe('LFO graph resolution', () => {
  it('an LFO wired to a play param resolves onto the play action as an lfo source', () => {
    const plays = evalPlays(lfoToBrightness());
    expect(plays).toHaveLength(1);
    const mods = plays[0]!.modulations;
    expect(mods).toHaveLength(1);
    expect(mods![0]!.targetParam).toBe('brightness');
    expect(mods![0]!.source.kind).toBe('lfo');
  });

  it('an LFO node does not fire as a trigger-flow child (inert source)', () => {
    const graph: TriggerGraph = {
      nodes: [trigger(), lfoNode(), playNode()],
      edges: [edge('e0', 'trigger', 'l'), edge('e1', 'l', 'p')],
    };
    expect(evalPlays(graph)).toHaveLength(0);
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
