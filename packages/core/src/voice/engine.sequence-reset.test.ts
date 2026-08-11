import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph, type TriggerSource } from './types';
import type { VoiceDiagnostic } from './diagnostics';

/*
 * A sequence node carrying its OWN `resetSource`, living in an ordinary pad graph — the
 * contained design from issue #159. Unit tests cover the matching/sweep; what only the engine
 * can answer is "does a raw input actually reach that node's state?": setShow → pad hits →
 * the bound reset input → more pad hits, asserting which effect each hit plays.
 */

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function effect(id: string): EffectDef {
  return {
    id,
    name: id,
    generatorId: 'solid-base',
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0.3 }],
    attackMs: 10,
    sustainMs: 1000,
    releaseMs: 50,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: { brightness: 0.3 }, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5,
    invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

const KEY = padKey('kick', '');

/** trigger(pad) → sequence(resetSource) → {A,B,C} → output — everything in ONE pad graph. */
function sequenceGraph(resetSource?: TriggerSource): TriggerGraph {
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger'),
      node('sequence', 'seq', resetSource ? { resetSource } : {}),
      node('play', 'a', { effectId: 'A' }),
      node('play', 'b', { effectId: 'B' }),
      node('play', 'c', { effectId: 'C' }),
      node('output', 'output'),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'seq' },
      { id: 'e1', from: 'seq', to: 'a' },
      { id: 'e2', from: 'seq', to: 'b' },
      { id: 'e3', from: 'seq', to: 'c' },
      { id: 'e4', from: 'a', to: 'output' },
      { id: 'e5', from: 'b', to: 'output' },
      { id: 'e6', from: 'c', to: 'output' },
    ],
  };
}

function show(graph: TriggerGraph): Show {
  return {
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 0 } satisfies Bus],
    graphs: { [KEY]: graph },
    sections: [],
    effects: [effect('A'), effect('B'), effect('C')],
    presets: [],
  };
}

const transport = (now: number): TransportState =>
  ({ timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true });

const padHit = (timeMs: number): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });
const resetNote = (timeMs: number): InputEvent => ({ kind: 'noteOn', note: 61, velocity: 1, timeMs });
const resetOsc = (timeMs: number): InputEvent => ({ kind: 'osc', address: '/reset', value: 1, timeMs });

/** Drive inputs and observe played effects + raw diagnostics. */
function run(graph: TriggerGraph): {
  fire: (e: InputEvent, at: number) => string[];
  diagnostics: VoiceDiagnostic[];
} {
  const played: string[] = [];
  const diagnostics: VoiceDiagnostic[] = [];
  const engine = createVoiceBusEngine({
    onDiagnostic: (d: VoiceDiagnostic) => {
      diagnostics.push(d);
      if (d.kind === 'graph-fired') played.push(...d.playEffects);
    },
  });
  engine.setModel(testModel());
  engine.setShow(show(graph));
  return {
    diagnostics,
    fire(e, at) {
      played.length = 0;
      engine.applyInput({ ...e, timeMs: at });
      engine.tick(at, 16, transport(at));
      return [...played];
    },
  };
}

describe('a sequence node with its own MIDI reset binding', () => {
  it('advances normally on pad hits — the binding alone never disturbs the sequence', () => {
    const { fire } = run(sequenceGraph({ kind: 'midi', note: 61 }));
    expect(fire(padHit(0), 0)).toEqual(['A']);
    expect(fire(padHit(100), 100)).toEqual(['B']);
    expect(fire(padHit(200), 200)).toEqual(['C']);
    expect(fire(padHit(300), 300)).toEqual(['A']); // wrapped naturally, never reset
  });

  it('snaps back to step 1 when the bound note arrives, playing nothing itself', () => {
    const { fire } = run(sequenceGraph({ kind: 'midi', note: 61 }));
    fire(padHit(0), 0); // A
    fire(padHit(100), 100); // B
    expect(fire(resetNote(200), 200)).toEqual([]); // resets silently
    expect(fire(padHit(300), 300)).toEqual(['A']); // back to step 1, not C
    expect(fire(padHit(400), 400)).toEqual(['B']); // and advances normally after
  });

  it('emits a sequence-reset diagnostic and never input-unrouted for a reset-only note', () => {
    const { fire, diagnostics } = run(sequenceGraph({ kind: 'midi', note: 61 }));
    fire(resetNote(0), 0);
    expect(diagnostics.some((d) => d.kind === 'sequence-reset' && d.graphKey === KEY && d.nodeId === 'seq')).toBe(true);
    expect(diagnostics.some((d) => d.kind === 'input-unrouted')).toBe(false);
  });

  it('a note bound to nothing still reports input-unrouted', () => {
    const { fire, diagnostics } = run(sequenceGraph({ kind: 'midi', note: 61 }));
    fire({ kind: 'noteOn', note: 99, velocity: 1, timeMs: 0 }, 0);
    expect(diagnostics.some((d) => d.kind === 'input-unrouted')).toBe(true);
  });
});

describe('a sequence node reset by an OSC address', () => {
  it('snaps back on the bound address', () => {
    const { fire } = run(sequenceGraph({ kind: 'osc', address: '/reset' }));
    fire(padHit(0), 0); // A
    fire(padHit(100), 100); // B
    expect(fire(resetOsc(200), 200)).toEqual([]);
    expect(fire(padHit(300), 300)).toEqual(['A']);
  });
});

describe('a sequence node reset by a drum pad', () => {
  it('reset applies BEFORE the fire, so a hit that both resets and triggers plays step 1', () => {
    // The reset is bound to the SAME pad that triggers the graph — every hit snaps then fires.
    const { fire } = run(sequenceGraph({ kind: 'drum', drumId: 'kick', zone: '' }));
    expect(fire(padHit(0), 0)).toEqual(['A']);
    expect(fire(padHit(100), 100)).toEqual(['A']); // reset first, so never B
    expect(fire(padHit(200), 200)).toEqual(['A']);
  });

  it('zone must match: a different zone leaves the sequence alone', () => {
    const { fire } = run(sequenceGraph({ kind: 'drum', drumId: 'kick', zone: 'rim' }));
    expect(fire(padHit(0), 0)).toEqual(['A']);
    expect(fire(padHit(100), 100)).toEqual(['B']); // zone '' hit ≠ 'rim' binding
  });
});
