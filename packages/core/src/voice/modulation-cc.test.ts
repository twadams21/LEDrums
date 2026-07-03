import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { ccKey, ccValue01, sampleCc, type CcTable } from './modulation';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

// S37 — CC-In modulation source: the engine holds a CC value table updated from the queued
// CC input events (determinism preserved), and a `cc` mapping reads it per frame so live
// voices track the controller continuously.

// ---- pure helpers (ccKey / ccValue01 / sampleCc) ----------------------------

describe('CC table helpers (S37)', () => {
  it('normalizes a raw 0..127 CC value to a clamped 0..1', () => {
    expect(ccValue01(0)).toBe(0);
    expect(ccValue01(127)).toBe(1);
    expect(ccValue01(64)).toBeCloseTo(64 / 127, 10);
    expect(ccValue01(-5)).toBe(0); // clamp low
    expect(ccValue01(200)).toBe(1); // clamp high
  });

  it('keys a specific channel apart from the omni slot', () => {
    expect(ccKey(20, null)).toBe('c20');
    expect(ccKey(20, 5)).toBe('c20@5');
    expect(ccKey(20, 5)).not.toBe(ccKey(20, 3));
  });

  it('sampleCc reads a value; absent table / unheard controller ⇒ 0 (neutral → rangeMin)', () => {
    const table: CcTable = new Map([
      [ccKey(20, null), 0.75],
      [ccKey(20, 5), 0.75],
    ]);
    expect(sampleCc(table, 20, null)).toBe(0.75); // omni reads the latest
    expect(sampleCc(table, 20, 5)).toBe(0.75); // matching channel
    expect(sampleCc(table, 20, 3)).toBe(0); // wrong channel → unheard → 0
    expect(sampleCc(table, 99, null)).toBe(0); // unheard controller → 0
    expect(sampleCc(undefined, 20, null)).toBe(0); // no table → 0
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

/** A flash effect whose `brightness` param (base 0 here) scales output intensity — so a CC
    mapped onto it is directly observable in the rendered frame. */
function fx(): EffectDef {
  return {
    id: 'fx',
    name: 'fx',
    pattern: 'flash',
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
    params: {}, env: {}, linked: false, noRepeat: true, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** trigger → play (loop, brightness base 0, exposes `brightness`) ← cc(controller, channel).
    The `param:brightness` edge maps the CC over [0,1] at full depth, so brightness == the CC. */
function ccGraph(controller: number, channel: number | null): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger'),
      node('play', 'pa', { effectId: 'fx', mode: 'loop', params: { brightness: 0 }, modInputs: [{ param: 'brightness' }] }),
      node('cc', 'cc1', { ccController: controller, ccChannel: channel }),
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
const cc = (controller: number, value: number, timeMs: number, channel?: number): InputEvent => ({
  kind: 'cc', controller, value, channel, timeMs,
});

function frameSum(f: Readonly<Float32Array>): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i]!;
  return s;
}

// ---- acceptance -------------------------------------------------------------

describe('VoiceBusEngine — CC-In modulation (S37)', () => {
  it('a queued CC event moves a mapped param on a live (looping) voice, continuously', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(ccGraph(20, null)));
    // Spawn the loop voice and age it past attack; brightness base is 0 and no CC has arrived,
    // so the voice is alive but dark.
    e.applyInput(hit(0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40));
    const dark = frameSum(e.frame());
    expect(dark).toBeCloseTo(0, 3);

    // A CC of 127 drives brightness → ~1 on the SAME live voice next frame.
    e.applyInput(cc(20, 127, 60));
    e.tick(60, 20, transport(60));
    const bright = frameSum(e.frame());
    expect(bright).toBeGreaterThan(0.5);

    // Dropping the CC back to 0 dims the same live voice again — continuous, not one-shot.
    e.applyInput(cc(20, 0, 80));
    e.tick(80, 20, transport(80));
    expect(frameSum(e.frame())).toBeLessThan(bright * 0.25);
  });

  it('honours the channel filter: a channel-specific node ignores other channels; omni tracks any', () => {
    // Channel-5 node — a CC on ch 3 must not move it, a CC on ch 5 must.
    const eCh = createVoiceBusEngine();
    eCh.setModel(testModel());
    eCh.setShow(show(ccGraph(20, 5)));
    eCh.applyInput(hit(0));
    eCh.tick(5, 5, transport(5));
    eCh.tick(40, 35, transport(40));
    eCh.applyInput(cc(20, 127, 60, 3)); // wrong channel
    eCh.tick(60, 20, transport(60));
    expect(frameSum(eCh.frame())).toBeCloseTo(0, 3);
    eCh.applyInput(cc(20, 127, 80, 5)); // right channel
    eCh.tick(80, 20, transport(80));
    expect(frameSum(eCh.frame())).toBeGreaterThan(0.5);

    // Omni node — tracks whatever channel last sent the controller.
    const eOmni = createVoiceBusEngine();
    eOmni.setModel(testModel());
    eOmni.setShow(show(ccGraph(20, null)));
    eOmni.applyInput(hit(0));
    eOmni.tick(5, 5, transport(5));
    eOmni.tick(40, 35, transport(40));
    eOmni.applyInput(cc(20, 127, 60, 3)); // any channel
    eOmni.tick(60, 20, transport(60));
    expect(frameSum(eOmni.frame())).toBeGreaterThan(0.5);
  });

  it('is deterministic: identical CC event logs produce byte-identical frames', () => {
    const events: InputEvent[] = [
      hit(0),
      cc(20, 30, 20),
      cc(20, 100, 55),
      cc(20, 64, 95),
      cc(20, 0, 130),
    ];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      e.setShow(show(ccGraph(20, null)));
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

  it('setShow clears the CC table (no stale values leak into a fresh show)', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(ccGraph(20, null)));
    e.applyInput(hit(0));
    e.applyInput(cc(20, 127, 5));
    e.tick(10, 10, transport(10));
    e.tick(45, 35, transport(45));
    expect(frameSum(e.frame())).toBeGreaterThan(0.5); // CC is live

    // Reloading the show must reset the table: the new loop voice starts dark until a new CC.
    e.setShow(show(ccGraph(20, null)));
    e.applyInput(hit(60));
    e.tick(65, 5, transport(65));
    e.tick(100, 35, transport(100));
    expect(frameSum(e.frame())).toBeCloseTo(0, 3);
  });
});
