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
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

/** trigger → play(effectId) with the given scope + optional targetId. */
function flatGraph(effectId: string, scope: 'drum' | 'kit' | 'hoop' = 'kit', targetId?: string): TriggerGraph {
  return {
    nodes: [node('trigger', 'trigger'), node('play', 'p1', { effectId, scope, targetId, params: { brightness: 1 } })],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  };
}

/** render helper: hit drumId and tick to full level; return frame + model. */
function renderPatt(scope: 'drum' | 'kit' | 'hoop', drumId: string, targetId?: string): {
  frame: Readonly<Float32Array>;
  model: PixelModel;
} {
  const m = testModel();
  const e = createVoiceBusEngine();
  const eff: EffectDef = {
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
  e.setShow(show(flatGraph('patt', scope, targetId), [eff], drumId));
  e.applyInput(hit(drumId, 0));
  e.tick(5, 5, transport(5));
  e.tick(40, 35, transport(40, 0.25));
  return { frame: e.frame(), model: m };
}

function renderGenTargeted(generatorId: string, scope: 'drum' | 'kit' | 'hoop', drumId: string, targetId?: string): {
  frame: Readonly<Float32Array>;
  model: PixelModel;
} {
  const m = testModel();
  const e = createVoiceBusEngine();
  e.setModel(m);
  e.setShow(show(flatGraph('fx', scope, targetId), [genEffect('fx', generatorId)], drumId));
  e.applyInput(hit(drumId, 0));
  e.tick(5, 5, transport(5));
  e.tick(40, 35, transport(40, 0.25));
  return { frame: e.frame(), model: m };
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

// ---- testModel pixel layout (for scope/targetId tests) ----------------------
// kick : hoopCount=2, pixelsPerHoop=29 → pixelStart=0,  pixelCount=58
//   hoop 0: [0, 29)   hoop 1: [29, 58)
// snare: hoopCount=2, pixelsPerHoop=24 → pixelStart=58, pixelCount=48
//   hoop 0: [58, 82)  hoop 1: [82, 106)

describe('Compositor — scope + targetId masking', () => {
  it('scope:hoop masks to one hoop\'s pixel range (kick hoop 0)', () => {
    const { frame, model } = renderPatt('hoop', 'kick', 'kick#0');
    const kick = model.drumById.get('kick')!;
    const hoopSize = kick.pixelsPerHoop; // 29
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThanOrEqual(hoopSize);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(0); // hoop 0 start
      expect(id).toBeLessThan(hoopSize);    // hoop 0 end
    }
  });

  it('scope:hoop with no targetId defaults to source drum hoop 0', () => {
    const { frame, model } = renderPatt('hoop', 'snare');
    const snare = model.drumById.get('snare')!;
    const h0start = snare.pixelStart;
    const h0end = snare.pixelStart + snare.pixelsPerHoop;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(h0start);
      expect(id).toBeLessThan(h0end);
    }
  });

  it('scope:drum with targetId overrides to the target drum (cross-drum)', () => {
    // Fire kick but targetId='snare' → only snare pixels light up.
    const { frame, model } = renderPatt('drum', 'kick', 'snare');
    const snare = model.drumById.get('snare')!;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(snare.pixelStart);
      expect(id).toBeLessThan(snare.pixelStart + snare.pixelCount);
    }
    // kick pixels must be dark
    const kick = model.drumById.get('kick')!;
    for (let i = kick.pixelStart; i < kick.pixelStart + kick.pixelCount; i++) {
      const j = i * 4;
      expect(frame[j]! + frame[j + 1]! + frame[j + 2]!).toBeLessThan(0.01);
    }
  });

  it('scope:kit ignores targetId — whole kit is lit', () => {
    const { frame, model } = renderPatt('kit', 'kick', 'kick');
    const lit = litPixels(frame, model.pixelCount);
    // kit-wide flash → every pixel in the kit lights up
    expect(lit.length).toBe(model.pixelCount);
  });

  it('scope:drum with dangling targetId renders nothing (no throw)', () => {
    expect(() => {
      const { frame, model } = renderPatt('drum', 'kick', 'does-not-exist');
      expect(litPixels(frame, model.pixelCount).length).toBe(0);
    }).not.toThrow();
  });

  it('scope:hoop with dangling targetId renders nothing (no throw)', () => {
    expect(() => {
      const { frame, model } = renderPatt('hoop', 'kick', 'does-not-exist#0');
      expect(litPixels(frame, model.pixelCount).length).toBe(0);
    }).not.toThrow();
  });

  it('scope:hoop with out-of-range hoop index renders nothing (no throw)', () => {
    expect(() => {
      const { frame, model } = renderPatt('hoop', 'kick', 'kick#99');
      expect(litPixels(frame, model.pixelCount).length).toBe(0);
    }).not.toThrow();
  });

  it('generator-backed effect respects drum scope with targetId override', () => {
    // Fire kick, target snare → the plasma generator's frame is masked to snare range.
    const { frame, model } = renderGenTargeted('plasma', 'drum', 'kick', 'snare');
    const snare = model.drumById.get('snare')!;
    const kick = model.drumById.get('kick')!;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(snare.pixelStart);
      expect(id).toBeLessThan(snare.pixelStart + snare.pixelCount);
    }
    // kick must be dark
    for (let i = kick.pixelStart; i < kick.pixelStart + kick.pixelCount; i++) {
      const j = i * 4;
      expect(frame[j]! + frame[j + 1]! + frame[j + 2]!).toBeLessThan(0.01);
    }
  });

  it('generator-backed effect respects hoop scope', () => {
    // Plasma with hoop scope → only kick hoop 0 pixels lit.
    const { frame, model } = renderGenTargeted('plasma', 'hoop', 'kick', 'kick#0');
    const kick = model.drumById.get('kick')!;
    const h0end = kick.pixelStart + kick.pixelsPerHoop;
    const lit = litPixels(frame, model.pixelCount);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(kick.pixelStart);
      expect(id).toBeLessThan(h0end);
    }
    // hoop 1 of kick must be dark
    for (let i = h0end; i < kick.pixelStart + kick.pixelCount; i++) {
      const j = i * 4;
      expect(frame[j]! + frame[j + 1]! + frame[j + 2]!).toBeLessThan(0.01);
    }
  });
});

// ---- S25: voice timebase (restart-on-trigger) -------------------------------
// chase is the tracer effect (timebase:'voice'): the generator bridge feeds it a
// hit-relative clock, so it starts at hoop 0 on the hit and restarts on retrigger. These
// are the engine-level goldens the S25 spec requires — chase at voice ages 0/200/800,
// identical across separate runs AND across retriggers. A retrigger is a NEW voice whose
// age is 0, so the retriggered animation matches a fresh one age-for-age.

/** A single 8-hoop drum: chase's active hoop is distinct at each sampled age (avoids the
    2-hoop model's aliasing so the golden actually pins the position). */
function chaseModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 8, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

/** chase on a base bus; attack 0 so voice age maps straight to animation (age 0 → level 1). */
function chaseShow(polyphony: 'mono' | 'poly'): Show {
  const bus: Bus = { id: 'base', name: 'Base', polyphony, crossfadeMs: 0 };
  return {
    buses: [bus],
    graphs: { [padKey('kick', '')]: flatGraph('fx', 'kit') },
    sections: [],
    effects: [genEffect('fx', 'chase', { attackMs: 0 })],
    presets: [],
  };
}

/** Fire chase once, sample the frame at the given voice age (transport bpm 120 throughout). */
function chaseAtAge(ageMs: number, polyphony: 'mono' | 'poly' = 'poly'): Readonly<Float32Array> {
  const e = createVoiceBusEngine();
  e.setModel(chaseModel());
  e.setShow(chaseShow(polyphony));
  e.applyInput(hit('kick', 0));
  e.tick(0, 0, transport(0)); // spawn at t=0 → born 0; attack 0 → full level this same tick
  if (ageMs > 0) e.tick(ageMs, ageMs, transport(ageMs));
  return e.frame();
}

/** Fire chase, run to t=500, retrigger (mono steal), then sample the NEW voice at `ageMs`. */
function chaseAfterRetrigger(ageMs: number): Readonly<Float32Array> {
  const e = createVoiceBusEngine();
  e.setModel(chaseModel());
  e.setShow(chaseShow('mono'));
  e.applyInput(hit('kick', 0));
  e.tick(0, 0, transport(0)); // voice A born 0
  e.tick(500, 500, transport(500)); // A ages to 500
  e.applyInput(hit('kick', 500)); // retrigger on the mono bus
  e.tick(500, 0, transport(500)); // mono steal: A → release, B born 500
  // Sample B at age `ageMs`. For ageMs ≥ the 100ms release ramp, A has fully faded and been
  // reaped, so only B contributes → directly comparable to a fresh voice at the same age.
  e.tick(500 + ageMs, ageMs, transport(500 + ageMs));
  return e.frame();
}

/** The sorted set of hoop indices lit in a frame (any channel > 0). */
function litHoopSet(f: Readonly<Float32Array>, m: PixelModel): number[] {
  const hoops = new Set<number>();
  for (const p of m.pixels) {
    const j = p.id * 4;
    if (f[j]! > 0.004 || f[j + 1]! > 0.004 || f[j + 2]! > 0.004) hoops.add(p.hoopIndex);
  }
  return [...hoops].sort((a, b) => a - b);
}

describe('Compositor — voice timebase / restart-on-trigger (S25)', () => {
  const m = chaseModel(); // deterministic layout — for interpreting hoop positions

  it('chase starts at hoop 0 on the hit (age 0 → beat 0 → step 0)', () => {
    expect(litHoopSet(chaseAtAge(0), m)).toEqual([0]);
  });

  it('chase advances on the voice clock, not frozen (ages 0/200/800 → distinct hoops)', () => {
    // voice-local beat = age×bpm/60000; subdivision 4 → step = floor(beat × 4).
    // age 0 → beat 0 → step 0 (hoop 0); age 200 → beat 0.4 → step 1 (hoop 1);
    // age 800 → beat 1.6 → step 6 (hoop 6).
    expect(litHoopSet(chaseAtAge(0), m)).toEqual([0]);
    expect(litHoopSet(chaseAtAge(200), m)).toEqual([1]);
    expect(litHoopSet(chaseAtAge(800), m)).toEqual([6]);
  });

  it('chase goldens are identical across separate runs (deterministic)', () => {
    const run = (): number[][] => [0, 200, 800].map((a) => Array.from(chaseAtAge(a)));
    expect(run()).toEqual(run());
  });

  it('chase restarts on retrigger: the retriggered voice matches a fresh voice age-for-age', () => {
    // Mono steal resets the voice → the second hit animates from 0 exactly like the first.
    for (const age of [200, 800]) {
      expect(Array.from(chaseAfterRetrigger(age))).toEqual(Array.from(chaseAtAge(age, 'mono')));
    }
  });

  it('absolute-timebase effects are age-independent: plasma at a fixed engine time is unchanged by birth time (golden parity)', () => {
    // My change only routes 'voice' generators onto a hit-relative clock; 'absolute'
    // generators (default) still read the engine wall-clock, so plasma sampled at the SAME
    // engine time is byte-identical regardless of how old the voice is.
    const plasmaAtEngineTime500 = (bornAt: number): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      e.setShow(show(flatGraph('fx', 'kit'), [genEffect('fx', 'plasma', { attackMs: 0 })], 'kick'));
      e.applyInput(hit('kick', bornAt));
      e.tick(bornAt, bornAt, transport(bornAt)); // spawn at bornAt (attack 0 → level 1)
      e.tick(500, 500 - bornAt, transport(500)); // sample at engine time 500 (ages 500 vs 300)
      return Array.from(e.frame());
    };
    expect(plasmaAtEngineTime500(0)).toEqual(plasmaAtEngineTime500(200));
  });
});
