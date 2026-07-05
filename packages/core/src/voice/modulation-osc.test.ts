import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { oscValue01, sampleOsc, type OscTable } from './modulation';
import { nodeModSource } from './modulation-graph';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

// OSC modulation source: the OSC analogue of the S37 CC source. The engine holds an OSC value
// table (address → 0..1) fed from queued OSC input events (determinism preserved), and a `cc`
// node in OSC mode reads it per frame so live voices track the address continuously.

// ---- pure helpers (oscValue01 / sampleOsc) ----------------------------------

describe('OSC table helpers', () => {
  it('clamps a raw OSC value to 0..1 (already a float; sender may overshoot)', () => {
    expect(oscValue01(0)).toBe(0);
    expect(oscValue01(1)).toBe(1);
    expect(oscValue01(0.42)).toBeCloseTo(0.42, 10);
    expect(oscValue01(-0.5)).toBe(0); // clamp low
    expect(oscValue01(3)).toBe(1); // clamp high
  });

  it('sampleOsc reads a value; absent table / unheard address ⇒ 0 (neutral → rangeMin)', () => {
    const table: OscTable = new Map([['/fader/1', 0.6]]);
    expect(sampleOsc(table, '/fader/1')).toBe(0.6);
    expect(sampleOsc(table, '/fader/2')).toBe(0); // unheard address → 0
    expect(sampleOsc(undefined, '/fader/1')).toBe(0); // no table → 0
  });
});

// ---- nodeModSource: a cc node in OSC mode resolves to an `osc` ModSource -----

describe('nodeModSource — OSC mode', () => {
  const cc = (over: Partial<GraphNode>): GraphNode => node('cc', 'cc1', over);

  it('OSC-mode cc node → { kind: "osc", address }', () => {
    expect(nodeModSource(cc({ ccSource: 'osc', oscAddress: '/fader/1' }))).toEqual({
      kind: 'osc',
      address: '/fader/1',
    });
  });
  it('OSC mode without an address falls back to "" (neutral until set)', () => {
    expect(nodeModSource(cc({ ccSource: 'osc' }))).toEqual({ kind: 'osc', address: '' });
  });
  it('default (MIDI) mode still resolves to a cc ModSource', () => {
    expect(nodeModSource(cc({ ccController: 20, ccChannel: 5 }))).toEqual({
      kind: 'cc',
      controller: 20,
      channel: 5,
    });
  });
});

// ---- engine fixtures --------------------------------------------------------

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function buses(): Bus[] {
  return [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];
}

/** A flash effect whose `brightness` param (base 0 here) scales output intensity — so an OSC
    value mapped onto it is directly observable in the rendered frame. */
function fx(): EffectDef {
  return {
    id: 'fx',
    name: 'fx',
    generatorId: 'solid-base',
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 100000, // effectively no decay over the test window
    releaseMs: 100,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** trigger → play (loop, brightness base 0, exposes `brightness`) ← cc(OSC address).
    The `param:brightness` edge maps the OSC value over [0,1] at full depth, so brightness == it. */
function oscGraph(address: string): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger'),
      node('play', 'pa', { effectId: 'fx', mode: 'loop', params: { brightness: 0 }, modInputs: [{ param: 'brightness' }] }),
      node('cc', 'cc1', { ccSource: 'osc', oscAddress: address }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'pa' },
      { id: 'e1', from: 'cc1', to: 'pa', toPort: 'param:brightness', amount: 1, invert: false, rangeMin: 0, rangeMax: 1 },
    ],
  };
}

function show(graph: TriggerGraph): Show {
  return { buses: buses(), graphs: { [padKey('kick', '')]: graph }, sections: [], effects: [fx()], presets: [] };
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

const hit = (timeMs: number): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });
const osc = (address: string, value: number, timeMs: number): InputEvent => ({ kind: 'osc', address, value, timeMs });

function frameSum(f: Readonly<Float32Array>): number {
  // Sum only the RGB channels (skip alpha): a generator owns its own alpha independent of
  // the modulated 'brightness' param, so visible light — what brightness scales — is the RGB.
  let s = 0;
  for (let i = 0; i < f.length; i += 4) s += f[i]! + f[i + 1]! + f[i + 2]!;
  return s;
}

// ---- acceptance -------------------------------------------------------------

describe('VoiceBusEngine — OSC modulation', () => {
  it('a queued OSC event moves a mapped param on a live (looping) voice, continuously', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(oscGraph('/fader/1')));
    // Spawn the loop voice and age it past attack; brightness base is 0 and no OSC has arrived,
    // so the voice is alive but dark.
    e.applyInput(hit(0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40));
    expect(frameSum(e.frame())).toBeCloseTo(0, 3);

    // OSC 1.0 drives brightness → ~1 on the SAME live voice next frame.
    e.applyInput(osc('/fader/1', 1, 60));
    e.tick(60, 20, transport(60));
    const bright = frameSum(e.frame());
    expect(bright).toBeGreaterThan(0.5);

    // Dropping the value back to 0 dims the same live voice again — continuous, not one-shot.
    e.applyInput(osc('/fader/1', 0, 80));
    e.tick(80, 20, transport(80));
    expect(frameSum(e.frame())).toBeLessThan(bright * 0.25);
  });

  it('reads only its own address: a different address does not move it', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(oscGraph('/fader/1')));
    e.applyInput(hit(0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40));
    e.applyInput(osc('/fader/2', 1, 60)); // other address
    e.tick(60, 20, transport(60));
    expect(frameSum(e.frame())).toBeCloseTo(0, 3);
    e.applyInput(osc('/fader/1', 1, 80)); // its own address
    e.tick(80, 20, transport(80));
    expect(frameSum(e.frame())).toBeGreaterThan(0.5);
  });

  it('is deterministic: identical OSC event logs produce byte-identical frames', () => {
    const events: InputEvent[] = [
      hit(0),
      osc('/fader/1', 0.2, 20),
      osc('/fader/1', 0.9, 55),
      osc('/fader/1', 0.5, 95),
      osc('/fader/1', 0, 130),
    ];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      e.setShow(show(oscGraph('/fader/1')));
      for (const ev of events) e.applyInput(ev);
      let now = 0;
      for (let i = 0; i < 20; i++) {
        now += 16;
        e.tick(now, 16, transport(now));
      }
      return Array.from(e.frame());
    };
    expect(run()).toEqual(run());
  });

  it('setShow clears the OSC table (no stale values leak into a fresh show)', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(oscGraph('/fader/1')));
    e.applyInput(hit(0));
    e.applyInput(osc('/fader/1', 1, 5));
    e.tick(10, 10, transport(10));
    e.tick(45, 35, transport(45));
    expect(frameSum(e.frame())).toBeGreaterThan(0.5); // OSC is live

    // Reloading the show must reset the table: the new loop voice starts dark until a new value.
    e.setShow(show(oscGraph('/fader/1')));
    e.applyInput(hit(60));
    e.tick(65, 5, transport(65));
    e.tick(100, 35, transport(100));
    expect(frameSum(e.frame())).toBeCloseTo(0, 3);
  });
});
