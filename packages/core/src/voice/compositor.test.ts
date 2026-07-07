import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { Framebuffer } from '../engine/framebuffer';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { createDefaultCompositor, type CompositorFrame } from './compositor';
import {
  padKey,
  type Bus,
  type EffectDef,
  type GraphNode,
  type ResolvedModifier,
  type Show,
  type TriggerGraph,
  type Voice,
} from './types';
import { getEffect } from '../effects/registry';

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

/** render helper: hit drumId and tick to full level; return frame + model. Uses breathing-kit
    (a continuous kit-wide fill — every pixel lit, geometry-uniform), so it exercises the
    compositor's scope/targetId MASK: the bridge blits only [start,end], so the lit set proves
    the mask, not the effect. */
function renderPatt(scope: 'drum' | 'kit' | 'hoop', drumId: string, targetId?: string): {
  frame: Readonly<Float32Array>;
  model: PixelModel;
} {
  const m = testModel();
  const e = createVoiceBusEngine();
  const eff: EffectDef = {
    id: 'patt',
    name: 'patt',
    generatorId: 'breathing-kit',
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

  it('two generator voices coexist in one frame, output stays in [0,1]', () => {
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
    e.setModel(m);
    e.setShow(show(g, [genEffect('patt', 'whole-drum'), genEffect('gen', 'breathing-kit')]));
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

// ---- S26: voice timebase conversion batch -----------------------------------
// The S26 slice flips the remaining free-running trigger effects to timebase:'voice'.
// Each converted effect must now (a) animate on the hit-relative clock (advances with voice
// age; birth-time dependent) and (b) restart on retrigger — a mono steal is a NEW voice
// whose age is 0, so its animation matches a fresh voice age-for-age. Absolute effects (base
// looks + textures) must be UNCHANGED: birth-time independent (no phase-snap on recall).
// These reuse the S25 harness shape, parametrized over the generator id (chaseModel below).

/** The nine effects converted in this slice. All restart on retrigger. */
const S26_VOICE_EFFECTS = [
  'synced-hoops', 'strobe', 'starfield', 'collisions', 'sacred-hogs',
  'gravity-wells', 'orbit-rings', 'comet-trails', 'temp-sweep',
] as const;

/** The subset that reads a phase clock (ctx.timeMs / ctx.transport) — for these the bridge's
    clock swap makes them birth-time dependent. comet-trails is excluded: it reads only ctx.dt
    (no clock), so its restart comes from per-voice genState reset, not a clock swap — its total
    accumulated dt is birth-independent, so the birth-dependence assertion below doesn't apply.
    Its restart is proven by the restart + no-leak tests instead. */
const S26_CLOCK_EFFECTS = S26_VOICE_EFFECTS.filter((id) => id !== 'comet-trails');

/** Generic single-generator show on a mono/poly base bus; attack 0 so voice age maps
    straight to animation (age 0 → full level this same tick). */
function fxShow(generatorId: string, polyphony: 'mono' | 'poly'): Show {
  const bus: Bus = { id: 'base', name: 'Base', polyphony, crossfadeMs: 0 };
  return {
    buses: [bus],
    graphs: { [padKey('kick', '')]: flatGraph('fx', 'kit') },
    sections: [],
    effects: [genEffect('fx', generatorId, { attackMs: 0 })],
    presets: [],
  };
}

/** Fire once, sample the frame at voice age `ageMs`. `prime` spawns-and-steals one throwaway
    voice first so the sampled voice is the engine's SECOND spawn — aligning its per-trigger
    RNG seed (item C: seed derives from the pool's voice counter) with a retriggered voice's,
    so retrigger-vs-fresh comparisons stay meaningful under per-trigger seeding. */
function fxAtAge(
  generatorId: string,
  ageMs: number,
  polyphony: 'mono' | 'poly' = 'poly',
  prime = false,
): Readonly<Float32Array> {
  const e = createVoiceBusEngine();
  e.setModel(chaseModel());
  e.setShow(fxShow(generatorId, polyphony));
  if (prime) {
    e.applyInput(hit('kick', 0));
    e.tick(0, 0, transport(0)); // throwaway voice #1 (stolen by the next mono spawn)
  }
  e.applyInput(hit('kick', 0));
  e.tick(0, 0, transport(0)); // spawn at t=0 → born 0; attack 0 → full level this same tick
  if (ageMs > 0) e.tick(ageMs, ageMs, transport(ageMs));
  return e.frame();
}

/** Fire, run to t=500, retrigger (mono steal), then sample the NEW voice at age `ageMs`.
    Mirrors chaseAfterRetrigger: B's tick sequence from spawn ([dt 0, dt ageMs]) matches a
    fresh voice, so dt accumulators and seeded RNG state replay identically. */
function fxAfterRetrigger(generatorId: string, ageMs: number): Readonly<Float32Array> {
  const e = createVoiceBusEngine();
  e.setModel(chaseModel());
  e.setShow(fxShow(generatorId, 'mono'));
  e.applyInput(hit('kick', 0));
  e.tick(0, 0, transport(0)); // voice A born 0
  e.tick(500, 500, transport(500)); // A ages to 500
  e.applyInput(hit('kick', 500)); // retrigger on the mono bus
  e.tick(500, 0, transport(500)); // mono steal: A → release, B born 500
  e.tick(500 + ageMs, ageMs, transport(500 + ageMs)); // B at age `ageMs` (A faded + reaped)
  return e.frame();
}

/** Sample at a FIXED engine time, varying birth time. A voice-timebase effect is birth-time
    DEPENDENT (different age → different frame); an absolute effect is birth-time INDEPENDENT
    (same engine time → same frame). This is the inverse of the S25 plasma absolute lock. */
function fxAtEngineTime(generatorId: string, engineT: number, bornAt: number): Readonly<Float32Array> {
  const e = createVoiceBusEngine();
  e.setModel(chaseModel());
  e.setShow(fxShow(generatorId, 'poly'));
  e.applyInput(hit('kick', bornAt));
  e.tick(bornAt, bornAt, transport(bornAt)); // spawn at bornAt (attack 0 → full level)
  e.tick(engineT, engineT - bornAt, transport(engineT)); // sample at fixed engine time
  return e.frame();
}

describe('Compositor — voice timebase conversion batch (S26)', () => {
  const m = chaseModel();
  // Ages ≥ the 100ms release ramp so the stolen mono voice is fully faded + reaped and the
  // sampled frame is the retriggered voice alone → directly comparable to a fresh voice.
  const AGES = [200, 800] as const;

  for (const id of S26_VOICE_EFFECTS) {
    it(`${id}: restarts on retrigger — retriggered voice matches a fresh voice age-for-age`, () => {
      for (const age of AGES) {
        // prime=true: match voice-counter-derived per-trigger seeds (retriggered voice = spawn #2)
        expect(Array.from(fxAfterRetrigger(id, age))).toEqual(Array.from(fxAtAge(id, age, 'mono', true)));
      }
    });

    it(`${id}: animates on the voice clock (not frozen) and lights pixels`, () => {
      const a = fxAtAge(id, AGES[0]);
      const b = fxAtAge(id, AGES[1]);
      // Non-empty at (at least) one sampled age, and the two ages render differently.
      expect(litPixels(a, m.pixelCount).length + litPixels(b, m.pixelCount).length).toBeGreaterThan(0);
      expect(Array.from(a)).not.toEqual(Array.from(b));
    });
  }

  for (const id of S26_CLOCK_EFFECTS) {
    it(`${id}: is birth-time dependent at a fixed engine time (voice clock, not wall-clock)`, () => {
      // Same engine time, two birth times → different voice ages → different frame. An
      // absolute effect is identical here (see the free-run lock below). Ages 800 vs 200.
      expect(Array.from(fxAtEngineTime(id, 800, 0))).not.toEqual(Array.from(fxAtEngineTime(id, 800, 600)));
    });
  }

  it('goldens are deterministic across separate runs', () => {
    const run = (): number[][] => S26_VOICE_EFFECTS.map((id) => Array.from(fxAtAge(id, 800)));
    expect(run()).toEqual(run());
  });

  it('stateful converted effects do not leak state across voices (collisions / sacred-hogs / comet-trails)', () => {
    // A retrigger gets a fresh genState; if accumulated flash / sparkle / orbit state leaked
    // from the stolen voice, the retriggered frame would differ from a fresh one. It does not.
    for (const id of ['collisions', 'sacred-hogs', 'comet-trails']) {
      // prime=true: align per-trigger seeds (item C) so only state leaks would differ
      expect(Array.from(fxAfterRetrigger(id, 800))).toEqual(Array.from(fxAtAge(id, 800, 'mono', true)));
    }
  });

  it('absolute effects still free-run: base + texture looks are birth-time INDEPENDENT (no phase-snap on recall)', () => {
    // The inverse of the voice test: at a fixed engine time an absolute generator renders the
    // same frame regardless of when its voice was born — so section recall never phase-snaps.
    for (const id of ['breathing-kit', 'hue-rotate-kit', 'solid-base', 'plasma', 'fire']) {
      expect(Array.from(fxAtEngineTime(id, 800, 0))).toEqual(Array.from(fxAtEngineTime(id, 800, 600)));
    }
  });

  it('registry timebase classification matches the S26 audit (executable audit of all 41 effects)', () => {
    // Pins the code to docs/handoff/rock-solid/effect-timebase-audit.md so the two can't drift.
    const VOICE = new Set([
      // Tier 1 — runtime conversions (this slice)
      'synced-hoops', 'strobe', 'starfield', 'collisions', 'sacred-hogs', 'gravity-wells',
      'orbit-rings', 'comet-trails', 'temp-sweep',
      // Tier 2 — intrinsic age-readers declared voice (byte-parity); chase landed in S25
      'chase', 'radial-wash', 'wave-collapse', 'whole-drum', 'whole-kit', 'follow-hoop',
      'burst', 'lightning',
    ]);
    const ABSOLUTE = new Set([
      // base / ambient — must stay free-running
      'breathing-kit', 'hue-rotate-kit', 'solid-base',
      // textures used as looks
      'plasma', 'fire', 'ripple-pond', 'rainbow-flow', 'tunnel', 'checker-pulse',
      'perlin-clouds', 'lava-lamp', 'interference', 'caustics', 'spiral', 'grid-glow',
      // free-running washes not in the S26 named set + hybrid (velocity-flames flicker) +
      // hit-driven seq/dt effects + param-driven meter (timebase flag immaterial for these)
      'helix', 'wipe-3d', 'velocity-flames',
      'confetti-burst', 'pixel-accum', 'colour-melody', 'swing', 'sidechain', 'meter-eq',
    ]);
    expect(VOICE.size + ABSOLUTE.size).toBe(41);
    for (const id of VOICE) expect(getEffect(id).timebase).toBe('voice');
    for (const id of ABSOLUTE) expect(getEffect(id).timebase ?? 'absolute').toBe('absolute');
  });
});

// ---- S28: modifier chain at the engine seam ---------------------------------
// The graph layer (S29) resolves a play node's `mod` closure into voice.modifiers; here we
// drive the compositor directly with hand-built voices carrying a resolved chain — the same
// seam, minus the topology. These pin: the chain applies between render and blend on BOTH
// paths (generator + pattern), temporal state is per-voice, bypass/unmodified is identity,
// chain order is respected, and the whole thing is deterministic.

/** A minimal live voice (mirrors makeVoiceSlot defaults) with per-test overrides. */
function mkVoice(over: Partial<Voice>): Voice {
  return {
    active: true,
    id: 'v1',
    effectId: 'fx',
    busId: 'base',
    mode: 'oneshot',
    scope: 'kit',
    targetId: undefined,
    sourceDrumId: 'kick',
    velocity: 1,
    seed: 0,
    // Every voice is generator-backed (U3). solid-base is a continuous kit-wide wash — a
    // stable, always-lit source for the modifier-chain seam tests below.
    generatorId: 'solid-base',
    genState: null,
    modifiers: undefined,
    modState: undefined,
    params: {},
    liveParams: { hue: 0, brightness: 0.3 },
    specs: [],
    attackMs: 0,
    sustainMs: 5000,
    releaseMs: 100,
    phase: 'sustain',
    level: 1,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 1,
    via: '',
    deckGain: 1,
    ...over,
  };
}

const trailMod = (params: Record<string, number | string>, bypass?: boolean): ResolvedModifier => ({
  modifierId: 'trail',
  params,
  bypass,
});

function total(f: Readonly<Float32Array>): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i]!;
  return s;
}

describe('Compositor — modifier chain (S28)', () => {
  const model = chaseModel(); // single 8-hoop kick drum
  const frame = (timeMs: number, dt: number): CompositorFrame => ({ timeMs, dt, transport: transport(timeMs) });

  /** Render `voices` at one frame into a fresh dst; return a copy of the frame. */
  function renderOnce(voices: Voice[], timeMs: number, dt: number): Float32Array {
    const c = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    c.render(voices, model, frame(timeMs, dt), dst);
    return Float32Array.from(dst.rgba);
  }

  /** Render the SAME compositor + voice across two frames; return [frame1, frame2]. */
  function renderTwo(mods: ResolvedModifier[] | undefined, dt: number): [Float32Array, Float32Array] {
    const c = createDefaultCompositor();
    const v = mkVoice({ modifiers: mods });
    const dst = new Framebuffer(model.pixelCount);
    c.render([v], model, frame(0, dt), dst);
    const f1 = Float32Array.from(dst.rgba);
    c.render([v], model, frame(dt, dt), dst);
    const f2 = Float32Array.from(dst.rgba);
    return [f1, f2];
  }

  it('generator voice: an add-Trail accumulates a tail across frames (per-voice temporal state)', () => {
    const [modF1, modF2] = renderTwo([trailMod({ decayMs: 1000, mode: 'add' })], 100);
    const [, baseF2] = renderTwo(undefined, 100);
    const [baseF1] = renderTwo(undefined, 100);
    // First frame is identity (empty accumulator): modified == unmodified.
    expect(Array.from(modF1)).toEqual(Array.from(baseF1));
    // An additive Trail can only add light: the trailed second frame is strictly brighter
    // than the unmodified second frame (the accumulated tail).
    expect(total(modF2)).toBeGreaterThan(total(baseF2));
  });

  it('generator voice: a Trail changes the composited output vs the unmodified baseline', () => {
    const gen = { generatorId: 'plasma', liveParams: { brightness: 1 } };
    const c1 = createDefaultCompositor();
    const c2 = createDefaultCompositor();
    const vMod = mkVoice({ ...gen, modifiers: [trailMod({ decayMs: 800, mode: 'add' })] });
    const vBase = mkVoice({ ...gen });
    const dstMod = new Framebuffer(model.pixelCount);
    const dstBase = new Framebuffer(model.pixelCount);
    // Two frames so the trail has history to add on the second.
    for (const t of [0, 100]) {
      c1.render([vMod], model, frame(t, 100), dstMod);
      c2.render([vBase], model, frame(t, 100), dstBase);
    }
    // Additive trail can only add light → strictly more total, and a different frame.
    expect(Array.from(dstMod.rgba)).not.toEqual(Array.from(dstBase.rgba));
    expect(total(dstMod.rgba)).toBeGreaterThan(total(dstBase.rgba));
  });

  it('bypass = identity, and unmodified spellings (undefined / [] / [bypassed]) all match baseline', () => {
    const dt = 100;
    const baseline = renderTwo(undefined, dt)[1];
    const empty = renderTwo([], dt)[1];
    const bypassed = renderTwo([trailMod({ decayMs: 1000, mode: 'add' }, true)], dt)[1];
    expect(Array.from(empty)).toEqual(Array.from(baseline));
    expect(Array.from(bypassed)).toEqual(Array.from(baseline));
  });

  it('chain application order is respected at the compositor seam', () => {
    // A time-varying generator (plasma) over several frames: two Trail links with distinct
    // decay+mode compose order-dependently (each feeds the other its output through its own
    // accumulator), so [a,b] and [b,a] diverge — the chain is applied in order, not commuted.
    const a = trailMod({ decayMs: 120, mode: 'add' });
    const b = trailMod({ decayMs: 500, mode: 'max' });
    const renderChain = (mods: ResolvedModifier[]): Float32Array => {
      const c = createDefaultCompositor();
      const v = mkVoice({ generatorId: 'plasma', liveParams: { brightness: 1 }, modifiers: mods });
      const dst = new Framebuffer(model.pixelCount);
      for (let i = 0; i < 4; i++) c.render([v], model, frame(i * 60, 60), dst);
      return Float32Array.from(dst.rgba);
    };
    expect(Array.from(renderChain([a, b]))).not.toEqual(Array.from(renderChain([b, a])));
  });

  it('a modified voice stays finite in [0,1] and is deterministic across runs', () => {
    const mods = [trailMod({ decayMs: 400, mode: 'add' })];
    const run = (): number[] => Array.from(renderTwo(mods, 50)[1]);
    const f = run();
    expect(allFiniteUnit(Float32Array.from(f))).toBe(true);
    expect(run()).toEqual(f);
  });

  it('an unknown modifier id renders as identity (never throws)', () => {
    const bad: ResolvedModifier[] = [{ modifierId: 'nope', params: {} }];
    expect(() => renderOnce([mkVoice({ modifiers: bad })], 0, 16)).not.toThrow();
    const withBad = renderOnce([mkVoice({ modifiers: bad })], 0, 16);
    const baseline = renderOnce([mkVoice({})], 0, 16);
    expect(Array.from(withBad)).toEqual(Array.from(baseline));
  });
});

// ---- Gen3 S08: Mix route buffer composition --------------------------------

function mixEffect(id: string, hue: number): EffectDef {
  return genEffect(id, 'whole-kit', {
    attackMs: 0,
    params: [
      { key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, default: hue },
      { key: 'saturation', label: 'Saturation', kind: 'number', min: 0, max: 1, default: 1 },
      { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 },
      { key: 'decayMs', label: 'Decay', kind: 'number', min: 1, max: 5000, default: 5000 },
    ],
  });
}

function mixPlay(id: string, effectId: string, y: number): GraphNode {
  return node('effect', id, {
    y,
    effectId,
    params: { hue: effectId === 'red' ? 0 : effectId === 'green' ? 120 : 240, saturation: 1, brightness: 1, decayMs: 5000 },
  });
}

function mixGraph(inputs: Array<{ id: string; effectId: string; y: number; opacity?: number }>, over: Partial<GraphNode> = {}, after: GraphNode[] = []): TriggerGraph {
  const mix = node('mix', 'mix', { y: 50, mixBlendMode: 'add', ...over } as Partial<GraphNode>);
  const output = node('output', 'output', { y: 50 });
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger', { y: 50 }),
      node('all', 'all', { y: 50 }),
      ...inputs.map((i) => mixPlay(i.id, i.effectId, i.y)),
      mix,
      ...after,
      output,
    ],
    edges: [
      { id: 'e-trigger', from: 'trigger', to: 'all' },
      ...inputs.map((i) => ({ id: `e-all-${i.id}`, from: 'all', to: i.id })),
      ...inputs.map((i) => ({ id: `e-${i.id}-mix`, from: i.id, to: 'mix', opacity: i.opacity })),
      after.length ? { id: 'e-mix-after', from: 'mix', to: after[0]!.id } : { id: 'e-mix-output', from: 'mix', to: 'output' },
      ...after.map((n, index) => ({ id: `e-after-${index}`, from: n.id, to: after[index + 1]?.id ?? 'output' })),
    ],
  };
}

function renderMix(graph: TriggerGraph, drumId = 'kick'): { frame: Readonly<Float32Array>; model: PixelModel; voices: number } {
  const e = createVoiceBusEngine();
  e.setModel(testModel());
  e.setShow(show(graph, [mixEffect('red', 0), mixEffect('green', 120), mixEffect('blue', 240)], drumId));
  e.applyInput(hit(drumId, 0));
  e.tick(0, 0, transport(0));
  return { frame: e.frame(), model: testModel(), voices: e.stats().voiceCount };
}

function rgbAt(f: Readonly<Float32Array>, pixel = 0): [number, number, number] {
  const i = pixel * 4;
  return [f[i]!, f[i + 1]!, f[i + 2]!];
}

describe('Gen3 Mix node — buffer composition', () => {
  it('composes multiple upstream effect routes into one output voice', () => {
    const { frame, voices } = renderMix(mixGraph([
      { id: 'a', effectId: 'red', y: 0 },
      { id: 'b', effectId: 'green', y: 100 },
    ]));
    const [r, g, b] = rgbAt(frame);
    expect(voices).toBe(1);
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeGreaterThan(0.9);
    expect(b).toBeLessThan(0.01);
  });

  it('uses the Mix node blend mode and each incoming edge opacity', () => {
    const normal = renderMix(mixGraph(
      [
        { id: 'a', effectId: 'red', y: 0, opacity: 1 },
        { id: 'b', effectId: 'green', y: 100, opacity: 0.5 },
      ],
      { mixBlendMode: 'normal' },
    )).frame;
    const [r, g, b] = rgbAt(normal);
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
    expect(g).toBeGreaterThan(0.45);
    expect(g).toBeLessThan(0.55);
    expect(b).toBeLessThan(0.01);
  });

  it('continues downstream through Scope after mixing', () => {
    const scope = node('scope', 'scope', { scope: 'drum', targetId: 'snare', y: 50 });
    const { frame, model } = renderMix(mixGraph(
      [
        { id: 'a', effectId: 'red', y: 0 },
        { id: 'b', effectId: 'green', y: 100 },
      ],
      { mixBlendMode: 'add' },
      [scope],
    ));
    const snare = model.drumById.get('snare')!;
    expect(litPixels(frame, model.pixelCount).every((id) => id >= snare.pixelStart && id < snare.pixelStart + snare.pixelCount)).toBe(true);
  });

  it('continues downstream through a Modifier node after mixing', () => {
    const modifier = node('modifier', 'mod', { y: 50, modifierId: 'slice', params: { widthPx: 8, jitter: 0, seed: 1 } });
    const { frame, model, voices } = renderMix(mixGraph(
      [
        { id: 'a', effectId: 'red', y: 0 },
        { id: 'b', effectId: 'green', y: 100 },
      ],
      { mixBlendMode: 'add' },
      [modifier],
    ));
    expect(voices).toBe(1);
    expect(litPixels(frame, model.pixelCount).length).toBeGreaterThan(0);
  });

  it('does not cap input count artificially', () => {
    const inputs = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, effectId: i % 3 === 0 ? 'red' : i % 3 === 1 ? 'green' : 'blue', y: i * 20 }));
    const { frame, voices } = renderMix(mixGraph(inputs, { mixBlendMode: 'add' }));
    const [r, g, b] = rgbAt(frame);
    expect(voices).toBe(1);
    expect(r + g + b).toBeGreaterThan(2.5);
  });

  it('orders inputs deterministically by upstream node y, independent of edge array order', () => {
    const g1 = mixGraph([
      { id: 'a', effectId: 'red', y: 0, opacity: 1 },
      { id: 'b', effectId: 'green', y: 100, opacity: 0.5 },
    ], { mixBlendMode: 'normal' });
    const g2: TriggerGraph = { ...g1, edges: [...g1.edges].reverse() };
    expect(Array.from(renderMix(g1).frame)).toEqual(Array.from(renderMix(g2).frame));
  });
});
