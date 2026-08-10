import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';
import type { VoiceDiagnostic } from './diagnostics';

/*
 * A `reset` node bound to its OWN MIDI note, living in the SAME graph as the sequencer it resets —
 * the co-location the unit tests can only half-cover, because "does the note actually reach that
 * node?" is engine-level resolution, not eval. Drives the real engine: setShow → pad hits → the
 * footswitch note → more pad hits, asserting which effect each hit plays.
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

/**
 * ONE graph holding both the sequencer and its reset:
 *   trigger(pad) → sequence → {A,B,C} → output
 *   reset(MIDI 61, → that sequence)                 [its own input source, not wired from trigger]
 */
function coLocatedGraph(): TriggerGraph {
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger'),
      node('sequence', 'seq'),
      node('play', 'a', { effectId: 'A' }),
      node('play', 'b', { effectId: 'B' }),
      node('play', 'c', { effectId: 'C' }),
      node('reset', 'r', { targetGraphKey: KEY, targetNodeId: 'seq', source: { kind: 'midi', note: 61 } }),
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
const footswitch = (timeMs: number): InputEvent => ({ kind: 'noteOn', note: 61, velocity: 1, timeMs });

/** Drive one input and return the effect ids it played, via the diagnostic sink. */
function run(): { fire: (e: InputEvent, at: number) => string[] } {
  const played: string[] = [];
  const engine = createVoiceBusEngine({
    onDiagnostic: (d: VoiceDiagnostic) => {
      if (d.kind === 'graph-fired') played.push(...d.playEffects);
    },
  });
  engine.setModel(testModel());
  engine.setShow(show(coLocatedGraph()));
  let t = 0;
  return {
    fire(e, at) {
      played.length = 0;
      engine.applyInput({ ...e, timeMs: at });
      t = at;
      engine.tick(t, 16, transport(t));
      return [...played];
    },
  };
}

describe('a reset node co-located with the sequencer it resets', () => {
  it('does not disturb the sequence on ordinary pad hits', () => {
    const { fire } = run();
    expect(fire(padHit(0), 0)).toEqual(['A']);
    expect(fire(padHit(100), 100)).toEqual(['B']);
    expect(fire(padHit(200), 200)).toEqual(['C']);
    expect(fire(padHit(300), 300)).toEqual(['A']); // wrapped naturally, never reset
  });

  it('snaps the sequence back when its own MIDI note arrives', () => {
    const { fire } = run();
    fire(padHit(0), 0); // A
    fire(padHit(100), 100); // B

    fire(footswitch(200), 200); // the reset's own note — reaches the node inside the pad's graph
    expect(fire(padHit(300), 300)).toEqual(['A']); // back to step 1, not C
  });

  it('the footswitch note does not fire the sequence itself (the reset has no children here)', () => {
    const { fire } = run();
    expect(fire(footswitch(0), 0)).toEqual([]); // resets silently
  });

  it('leaves the pad path firing normally afterwards', () => {
    const { fire } = run();
    fire(footswitch(0), 0);
    expect(fire(padHit(100), 100)).toEqual(['A']);
    expect(fire(padHit(200), 200)).toEqual(['B']);
  });
});
