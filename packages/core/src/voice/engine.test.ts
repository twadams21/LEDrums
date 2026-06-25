import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createNullEngine, createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

// ---- fixtures ---------------------------------------------------------------

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
  return [
    { id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 },
    { id: 'lead', name: 'Lead', polyphony: 'mono', crossfadeMs: 120 },
  ];
}

function effect(id: string, over: Partial<EffectDef> = {}): EffectDef {
  return {
    id,
    name: id,
    pattern: 'flash',
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 100,
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
    on: 'velocity',
    p: 0.5,
    ...over,
  };
}

/** trigger → all → [play A, play B] */
function allGraph(): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger', { y: 0 }),
      node('all', 'all', { y: 0 }),
      node('play', 'pa', { y: 0, effectId: 'fxA', params: { brightness: 1 } }),
      node('play', 'pb', { y: 100, effectId: 'fxB', busId: 'lead', params: { brightness: 1 } }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'all' },
      { id: 'e1', from: 'all', to: 'pa' },
      { id: 'e2', from: 'all', to: 'pb' },
    ],
  };
}

/** trigger → sequence → [play A, play B] (alternates each hit) */
function sequenceGraph(): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger', { y: 0 }),
      node('sequence', 'seq', { y: 0 }),
      node('play', 'pa', { y: 0, effectId: 'fxA' }),
      node('play', 'pb', { y: 100, effectId: 'fxB' }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'seq' },
      { id: 'e1', from: 'seq', to: 'pa' },
      { id: 'e2', from: 'seq', to: 'pb' },
    ],
  };
}

/** trigger → toggle → play A (on a mono lead bus, holds) */
function toggleGraph(): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger', { y: 0 }),
      node('toggle', 'tog', { y: 0 }),
      node('play', 'pa', { y: 0, effectId: 'fxHold', mode: 'hold', busId: 'lead' }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'tog' },
      { id: 'e1', from: 'tog', to: 'pa' },
    ],
  };
}

function show(graph: TriggerGraph, extraEffects: EffectDef[] = []): Show {
  return {
    buses: buses(),
    graphs: { [padKey('kick', '')]: graph },
    sections: [],
    effects: [effect('fxA'), effect('fxB'), effect('fxHold', { busId: 'lead' }), ...extraEffects],
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

// ---- tests ------------------------------------------------------------------

describe('createNullEngine', () => {
  it('returns an all-zero frame of pixelCount*4', () => {
    const m = testModel();
    const e = createNullEngine();
    e.setModel(m);
    e.setShow(show(allGraph()));
    e.applyInput(hit());
    e.tick(16, 16, transport(16));
    const f = e.frame();
    expect(f.length).toBe(m.pixelCount * 4);
    expect(Array.from(f).every((x) => x === 0)).toBe(true);
    expect(e.stats().voiceCount).toBe(0);
  });
});

describe('VoiceBusEngine — graph eval parity (deterministic nodes)', () => {
  it('all node spawns one voice per play child', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(allGraph()));
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5));
    expect(e.stats().voiceCount).toBe(2);
  });

  it('sequence node alternates children across hits', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(sequenceGraph()));
    // hit 1 → fxA on base; hit 2 → fxB on base. Both poly, both alive.
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5));
    expect(e.stats().voiceCount).toBe(1);
    e.applyInput(hit('kick', 10));
    e.tick(15, 10, transport(15));
    expect(e.stats().voiceCount).toBe(2);
  });

  it('mono bus steals: a second lead voice releases the first', () => {
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('play', 'pa', { effectId: 'fxHold', mode: 'hold', busId: 'lead' }),
      ],
      edges: [{ id: 'e0', from: 'trigger', to: 'pa' }],
    };
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(g));
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5)); // spawns the voice (born at 5)
    e.tick(40, 35, transport(40)); // voice ages past attack → sustain
    expect(e.stats().busLevels.lead).toBeGreaterThan(0.5);
    e.applyInput(hit('kick', 45));
    e.tick(50, 10, transport(50));
    // Old voice is releasing, new voice in attack — at most one full-level lead voice.
    expect(e.stats().voiceCount).toBeLessThanOrEqual(2);
  });

  it('toggle node latches on then off across two hits', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(toggleGraph()));
    e.applyInput(hit('kick', 0));
    e.tick(20, 20, transport(20));
    expect(e.stats().voiceCount).toBe(1); // toggled on (hold voice alive)
    e.applyInput(hit('kick', 25));
    e.tick(30, 10, transport(30));
    // toggled off → voice now releasing; let it die out.
    for (let i = 0; i < 60; i++) e.tick(30 + i * 16, 16, transport(30 + i * 16));
    expect(e.stats().voiceCount).toBe(0);
  });

  it('lights pixels for a kit-scoped flash and scopes a drum voice to its range', () => {
    const m = testModel();
    const kickCount = m.drumById.get('kick')!.pixelCount;
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('play', 'pa', { effectId: 'fxA', scope: 'drum', params: { brightness: 1 } }),
      ],
      edges: [{ id: 'e0', from: 'trigger', to: 'pa' }],
    };
    const e = createVoiceBusEngine();
    e.setModel(m);
    e.setShow(show(g));
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5)); // spawn (born at 5)
    e.tick(40, 35, transport(40)); // age past attack so level > 0
    const f = e.frame();
    let lit = 0;
    for (let i = 0; i < m.pixelCount; i++) {
      const j = i * 4;
      if (f[j]! > 0.004 || f[j + 1]! > 0.004 || f[j + 2]! > 0.004) lit++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(kickCount); // drum-scoped: only kick's pixels
  });

  // Regression: a drum-scoped voice whose sourceDrumId is absent from the engine's
  // kit renders NOTHING (the compositor `drumById.get(id)` misses → skip). This is
  // the failure mode behind "effects don't trigger reliably" when the authored
  // content's drum ids drift from the engine kit's (e.g. fixtures 'tom' vs kit
  // 'tom1'). A kit-scoped voice with the same unknown id still lights (it ignores
  // the drum), which is why washes survived while per-drum effects vanished.
  const litCount = (f: Readonly<Float32Array>, n: number): number => {
    let lit = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      if (f[j]! > 0.004 || f[j + 1]! > 0.004 || f[j + 2]! > 0.004) lit++;
    }
    return lit;
  };
  const fireScoped = (scope: 'drum' | 'kit', drumId: string): Readonly<Float32Array> => {
    const m = testModel(); // drums: kick, snare
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('play', 'pa', { effectId: 'fxA', scope, params: { brightness: 1 } }),
      ],
      edges: [{ id: 'e0', from: 'trigger', to: 'pa' }],
    };
    const e = createVoiceBusEngine();
    e.setModel(m);
    // register the graph under the (possibly unknown) drum so the hit resolves it
    e.setShow({ ...show(g), graphs: { [padKey(drumId, '')]: g } });
    e.applyInput(hit(drumId, 0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40)); // age past attack so level > 0
    return e.frame();
  };

  it('drum-scoped voice with an unknown drum id lights nothing (id-drift regression)', () => {
    const m = testModel();
    expect(litCount(fireScoped('drum', 'kick'), m.pixelCount)).toBeGreaterThan(0); // known → lit
    expect(litCount(fireScoped('drum', 'ghost'), m.pixelCount)).toBe(0); // unknown → dark
  });

  it('kit-scoped voice lights regardless of the source drum id', () => {
    const m = testModel();
    // even an unknown source drum lights the whole kit (scope ignores the drum) —
    // explains why kit washes kept working while drum-scoped effects went dark.
    expect(litCount(fireScoped('kit', 'ghost'), m.pixelCount)).toBeGreaterThan(0);
  });
});

describe('VoiceBusEngine — determinism', () => {
  it('two engines with identical (model, show, inputs, ticks) produce byte-identical frames', () => {
    const events: InputEvent[] = [
      hit('kick', 5, 0.9),
      hit('kick', 40, 0.4),
      hit('kick', 90, 1),
      hit('kick', 130, 0.7),
    ];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      // use a chance/random graph to exercise the PRNG path
      const g: TriggerGraph = {
        nodes: [
          node('trigger', 'trigger'),
          node('random', 'rnd', { noRepeat: true }),
          node('play', 'pa', { y: 0, effectId: 'fxA', params: { brightness: 1 } }),
          node('play', 'pb', { y: 100, effectId: 'fxB', params: { brightness: 1 } }),
          node('chance', 'ch', { y: 200, p: 0.5 }),
          node('play', 'pc', { y: 200, effectId: 'fxA', scope: 'drum', params: { brightness: 1 } }),
        ],
        edges: [
          { id: 'e0', from: 'trigger', to: 'rnd' },
          { id: 'e1', from: 'rnd', to: 'pa' },
          { id: 'e2', from: 'rnd', to: 'pb' },
          { id: 'e3', from: 'trigger', to: 'ch' },
          { id: 'e4', from: 'ch', to: 'pc' },
        ],
      };
      e.setShow(show(g));
      for (const ev of events) e.applyInput(ev);
      let now = 0;
      for (let i = 0; i < 40; i++) {
        now += 16;
        e.tick(now, 16, transport(now, (now / 1000) * 2));
      }
      return Array.from(e.frame());
    };
    expect(run()).toEqual(run());
  });
});

describe('VoiceBusEngine — zero-alloc / cap sanity', () => {
  it('rapid triggers stay within the voice cap and never throw', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(allGraph()));
    let now = 0;
    expect(() => {
      for (let i = 0; i < 2000; i++) {
        now += 4;
        e.applyInput(hit('kick', now, 1));
        e.tick(now, 4, transport(now, (now / 1000) * 2));
        expect(e.stats().voiceCount).toBeLessThanOrEqual(256);
      }
    }).not.toThrow();
  });

  it('frame() is the same Float32Array instance across ticks (no per-frame copy)', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(show(allGraph()));
    e.tick(16, 16, transport(16));
    const a = e.frame();
    e.tick(32, 16, transport(32));
    const b = e.frame();
    expect(a).toBe(b);
  });
});
