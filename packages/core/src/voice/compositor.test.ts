import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

// ---- fixtures (mirror engine.test.ts so the bridge is exercised end-to-end) ----

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'snare', diameterIn: 10, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  });
  return buildPixelModel(kit);
}

function buses(): Bus[] {
  return [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];
}

/** A generator-backed effect: hosts the legacy EffectGenerator `generatorId`. Long
 *  sustain so the voice sits at full level while we sample the frame. */
function genEffect(id: string, generatorId: string, over: Partial<EffectDef> = {}): EffectDef {
  return {
    id,
    name: id,
    pattern: 'flash', // ignored for generator-backed effects
    generatorId,
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 5000,
    releaseMs: 100,
    ...over,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    ...over,
  };
}

/** trigger → play(effectId) with the given scope. */
function flatGraph(effectId: string, scope: 'drum' | 'kit' = 'kit'): TriggerGraph {
  return {
    nodes: [node('trigger', 'trigger'), node('play', 'p1', { effectId, scope, params: { brightness: 1 } })],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  };
}

function show(graph: TriggerGraph, effects: EffectDef[], drumId = 'kick'): Show {
  return {
    buses: buses(),
    graphs: { [padKey(drumId, '')]: graph },
    sections: [],
    effects,
    presets: [],
  };
}

function transport(now: number, beat = 0, bpm = 120): TransportState {
  return {
    timeMs: now,
    beat,
    bar: Math.floor(beat / 4),
    beatInBar: beat - Math.floor(beat / 4) * 4,
    bpm,
    beatsPerBar: 4,
    playing: true,
  };
}

function hit(drumId = 'kick', timeMs = 0, velocity = 1): InputEvent {
  return { kind: 'noteOn', drumId, zone: '', velocity, timeMs };
}

/** Drive a hit through a generator effect and return the lit frame (aged past attack). */
function renderGen(generatorId: string, scope: 'drum' | 'kit', drumId = 'kick'): {
  frame: Readonly<Float32Array>;
  model: PixelModel;
} {
  const m = testModel();
  const e = createVoiceBusEngine();
  e.setModel(m);
  e.setShow(show(flatGraph('fx', scope), [genEffect('fx', generatorId)], drumId));
  e.applyInput(hit(drumId, 0));
  e.tick(5, 5, transport(5)); // spawn (born at 5)
  e.tick(40, 35, transport(40, 0.25)); // age past 10ms attack → level 1
  return { frame: e.frame(), model: m };
}

function litPixels(f: Readonly<Float32Array>, n: number): number[] {
  const lit: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (f[j]! > 0.004 || f[j + 1]! > 0.004 || f[j + 2]! > 0.004) lit.push(i);
  }
  return lit;
}

function allFiniteUnit(f: Readonly<Float32Array>): boolean {
  for (let i = 0; i < f.length; i++) {
    const x = f[i]!;
    if (!Number.isFinite(x) || x < 0 || x > 1) return false;
  }
  return true;
}

// ---- tests ------------------------------------------------------------------

describe('Compositor — hosted legacy-generator bridge', () => {
  it('renders a kit-wide field generator: lights pixels, all channels finite in [0,1]', () => {
    const { frame, model } = renderGen('plasma', 'kit');
    expect(allFiniteUnit(frame)).toBe(true);
    expect(litPixels(frame, model.pixelCount).length).toBeGreaterThan(0);
  });

  it('a kit-scoped trigger generator (whole-drum) lights only the struck drum', () => {
    // whole-drum renders from the synthetic trigger's drumId — even kit-scoped, only
    // the struck drum's pixels are written (proves the synthetic-trigger plumbing).
    const { frame, model } = renderGen('whole-drum', 'kit', 'snare');
    const snare = model.drumById.get('snare')!;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(snare.pixelStart);
      expect(id).toBeLessThan(snare.pixelStart + snare.pixelCount);
    }
  });

  it('a drum-scoped field generator is masked to the source drum range', () => {
    // plasma fills the whole kit, but a drum-scoped voice blits only the struck drum.
    const { frame, model } = renderGen('plasma', 'drum', 'snare');
    const snare = model.drumById.get('snare')!;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThanOrEqual(snare.pixelCount);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(snare.pixelStart);
      expect(id).toBeLessThan(snare.pixelStart + snare.pixelCount);
    }
  });

  it('a stateful seeded generator (starfield) renders finite in [0,1]', () => {
    const { frame } = renderGen('starfield', 'kit');
    expect(allFiniteUnit(frame)).toBe(true);
  });

  it('an unknown generatorId renders nothing (no fall-through to the pattern path)', () => {
    const { frame, model } = renderGen('does-not-exist', 'kit');
    expect(litPixels(frame, model.pixelCount).length).toBe(0);
  });

  it('determinism: two engines with identical (model, show, inputs, ticks) match byte-for-byte', () => {
    // Exercise both per-hit seeded RNG (lightning ← trig.seq) and createState seeding.
    const events: InputEvent[] = [hit('kick', 5, 0.9), hit('snare', 40, 0.5), hit('kick', 90, 1)];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      e.setShow(
        show(flatGraph('fx', 'kit'), [genEffect('fx', 'lightning')]),
      );
      // also register a snare pad so the snare hit resolves
      const s = show(flatGraph('fx', 'kit'), [genEffect('fx', 'lightning')]);
      e.setShow({ ...s, graphs: { ...s.graphs, [padKey('snare', '')]: flatGraph('fx', 'kit') } });
      for (const ev of events) e.applyInput(ev);
      let now = 0;
      for (let i = 0; i < 30; i++) {
        now += 16;
        e.tick(now, 16, transport(now, (now / 1000) * 2));
      }
      return Array.from(e.frame());
    };
    expect(run()).toEqual(run());
  });

  it('pattern and generator voices coexist in one frame, output stays in [0,1]', () => {
    const m = testModel();
    const e = createVoiceBusEngine();
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('all', 'all'),
        node('play', 'pa', { y: 0, effectId: 'patt', params: { brightness: 1 } }),
        node('play', 'pb', { y: 100, effectId: 'gen', params: { brightness: 1 } }),
      ],
      edges: [
        { id: 'e0', from: 'trigger', to: 'all' },
        { id: 'e1', from: 'all', to: 'pa' },
        { id: 'e2', from: 'all', to: 'pb' },
      ],
    };
    const patt: EffectDef = {
      id: 'patt',
      name: 'patt',
      pattern: 'flash',
      busId: 'base',
      scope: 'kit',
      params: [{ key: 'brightness', label: 'B', kind: 'number', default: 1 }],
      attackMs: 10,
      sustainMs: 5000,
      releaseMs: 100,
    };
    e.setModel(m);
    e.setShow(show(g, [patt, genEffect('gen', 'breathing-kit')]));
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40, 0.25));
    expect(e.stats().voiceCount).toBe(2);
    expect(allFiniteUnit(e.frame())).toBe(true);
    expect(litPixels(e.frame(), m.pixelCount).length).toBeGreaterThan(0);
  });
});
