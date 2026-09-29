/* Effect chains S03 §4 — Splice and Slice as Generators.
   The oracle throughout is the EXISTING graph splice / slice node: a device must resolve to
   the same layout the graph node resolves to, and an Effect must render the same frames the
   equivalent graph splice renders through the real engine. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from '../voice/engine';
import { resolveSplices } from '../voice/splice';
import { resolveSlice } from '../voice/slice';
import { emptyShow, padKey, type EffectDef, type GraphNode, type Show, type SpliceDef, type TriggerGraph } from '../voice/types';
import { getGeneratorDef, listGenerators, resolveGenerator } from './generators';
import { resolveSpliceGenerator, spliceDeviceNode, spliceGeneratorParamSpec } from './resolve-splice';
import { effectPlayAction } from './resolver';
import { chainEffectDef, chainEffectDefId } from './runtime';
import { parseEffect, type Effect, type GeneratorDevice, type SpliceSlot } from './types';

const device = (kind: 'splice' | 'slice', params: GeneratorDevice['params'], slots: SpliceSlot[]): GeneratorDevice => ({
  kind, style: '', params, slots,
});

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '', params: {}, env: {},
    noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5, invert: false, bands: [0.5], p: 0.5,
    delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** Every scalar splice setting at a non-default value, as device params and as node fields. */
const RICH_PARAMS: GeneratorDevice['params'] = {
  count: 6, partition: 'drum', jitter: 0.3, seed: 7, chase: 'stagger', rateMode: 'beats', rateMs: 90,
  division: '1/16', direction: -1, incrementPx: 3, offsetMode: 'time', offsetMs: 120, offsetDivision: '1/4',
  order: 'outside-in', drumOffsetMode: 'beats', drumOffsetMs: 50, drumOffsetDivision: '1/8', drumOrder: 'down',
  smudge: 0.4, motionMode: 'latched', colorOffsetMode: 'beats', colorOffsetMs: 10, colorOffsetDivision: 'triplet-1/8',
  colorOrder: 'random', rotationDeg: 400, waitMode: 'pulse', attackMs: 25, holdMs: 700, releaseMs: 150,
  attackEaseFn: 'cubic', attackEaseDir: 'out', tint: 0.6, drumSequence: 'snare, kick', hoopSequence: '2,1',
};
const RICH_NODE: Partial<GraphNode> = {
  spliceCount: 6, splicePartition: 'drum', spliceJitter: 0.3, spliceSeed: 7, spliceChase: 'stagger',
  spliceRateMode: 'beats', spliceRateMs: 90, spliceDivision: '1/16', spliceDirection: -1, spliceIncrementPx: 3,
  spliceOffsetMode: 'time', spliceOffsetMs: 120, spliceOffsetDivision: '1/4', spliceOrder: 'outside-in',
  spliceDrumOffsetMode: 'beats', spliceDrumOffsetMs: 50, spliceDrumOffsetDivision: '1/8', spliceDrumOrder: 'down',
  spliceSmudge: 0.4, spliceMotionMode: 'latched', spliceColorOffsetMode: 'beats', spliceColorOffsetMs: 10,
  spliceColorOffsetDivision: 'triplet-1/8', spliceColorOrder: 'random', spliceRotationDeg: 400, spliceWaitMode: 'pulse',
  spliceAttackMs: 25, spliceHoldMs: 700, spliceReleaseMs: 150, spliceAttackEase: { fn: 'cubic', dir: 'out' },
  spliceTint: 0.6, spliceDrumSequence: ['snare', 'kick'], spliceHoopSequence: [2, 1],
};
const COLOUR_SLOTS: SpliceSlot[] = [{ color: '#ff0000' }, { color: '#0000ff' }];
const COLOUR_DEFS: SpliceDef[] = [{ color: '#ff0000' }, { color: '#0000ff' }];

describe('Splice / Slice device → the existing splice layout', () => {
  it('resolves every splice setting to the same config the graph splice node resolves to', () => {
    const got = resolveSpliceGenerator(device('splice', RICH_PARAMS, COLOUR_SLOTS), { bpm: 96, beatsPerBar: 3 })!;
    const oracle = resolveSplices(node('splice', 's', { ...RICH_NODE, splices: COLOUR_DEFS }), 96, 3)!;
    expect(got.splice).toEqual(oracle.config);
    expect(got.envelope).toEqual(oracle.envelope);
  });

  it('resolves a slice with its geometry, drum offset kept live, like the graph slice node', () => {
    const params = {
      ...RICH_PARAMS, axis: 'z', rotX: 30, rotY: -20, rotZ: 370, velocity: 0.5, incrementPct: 25,
      regionCx: 10, regionCy: 20, regionCz: 30, regionSx: 100, regionSy: 200, regionSz: 300,
    };
    const got = resolveSpliceGenerator(device('slice', params, COLOUR_SLOTS), { bpm: 140 })!;
    const { splicePartition: _p, spliceIncrementPx: _i, ...sliceNode } = RICH_NODE;
    const oracle = resolveSlice(node('slice', 's', {
      ...sliceNode, splices: COLOUR_DEFS, sliceAxis: 'z', sliceRotX: 30, sliceRotY: -20, sliceRotZ: 370,
      sliceVelocity: 0.5, sliceIncrementPct: 25, sliceRegion: { cx: 10, cy: 20, cz: 30, sx: 100, sy: 200, sz: 300 },
    }), 140)!;
    expect(got.splice).toEqual(oracle.config);
    expect(got.splice!.space).toBeDefined();
    expect(got.splice!.drumOffsetMs).toBeGreaterThan(0);
  });

  it('leaves the machinery defaults in force for absent, mistyped and out-of-enum params', () => {
    const got = resolveSpliceGenerator(device('splice', {
      count: 'six', partition: 'spiral', chase: 3, order: 'sideways', offsetDivision: 'none', attackEaseFn: 'linear',
    }, COLOUR_SLOTS))!;
    const oracle = resolveSplices(node('splice', 's', { splices: COLOUR_DEFS }), 120)!;
    expect(got.splice).toEqual(oracle.config);
  });

  it('resolves bpm-synced timings against the fire tempo, defaulting to 120', () => {
    const d = device('splice', { chase: 'step', rateMode: 'beats', division: '1/4' }, COLOUR_SLOTS);
    expect(resolveSpliceGenerator(d)!.splice!.chaseMs).toBe(500);
    expect(resolveSpliceGenerator(d, { bpm: 60 })!.splice!.chaseMs).toBe(1000);
  });

  it('takes an envelope override (the Effect amp) for the per-unit envelope', () => {
    const env = { attackMs: 1, sustainMs: 2, releaseMs: 3 };
    const got = resolveSpliceGenerator(device('splice', { holdMs: 999 }, COLOUR_SLOTS), { envelope: env })!;
    expect(got.envelope).toEqual(env);
    expect(got.splice!.envelope).toEqual(env);
  });
});

describe('Splice slots', () => {
  it('turns colour slots into solid-colour members through the Effect runtime', () => {
    const got = resolveSpliceGenerator(device('splice', { count: 2 }, COLOUR_SLOTS))!;
    expect(got.effectId).toBe('solid-colour');
    expect(got.params).toEqual({});
    expect(got.spliceInputs!.map((m) => [m.effectId, m.params.color])).toEqual([
      [chainEffectDefId('solid-colour'), '#ff0000'],
      [chainEffectDefId('solid-colour'), '#0000ff'],
    ]);
    expect(got.splice!.inputBySlot).toEqual([0, 1]);
  });

  it('hosts a nested Generator with its Style, spec defaults under its params, tinted by a slot colour', () => {
    const nested: GeneratorDevice = { kind: 'wave', style: 'chase', params: { speed: 2 } };
    const got = resolveSpliceGenerator(device('splice', { count: 2 }, [{ color: '#00ff00', generator: nested }, { color: '#ff0000' }]))!;
    const member = got.spliceInputs![0]!;
    expect(member.effectId).toBe(chainEffectDefId('chase-bands'));
    expect(member.params.speed).toBe(2);
    expect(Object.keys(member.params).sort()).toEqual(chainEffectDef('chase-bands')!.params.map((p) => p.key).sort());
    expect(got.splice!.colors).toEqual(['#00ff00', '#ff0000']);
    expect(got.effectId).toBe('chase-bands');
  });

  it('blanks muted slots, empty slots, nested Splices and unresolvable nested Generators', () => {
    const got = resolveSpliceGenerator(device('splice', { count: 5 }, [
      { color: '#ff0000', muted: true },
      {},
      { generator: { kind: 'splice', style: '', params: {}, slots: COLOUR_SLOTS } },
      { generator: { kind: 'wave', style: 'no-such-style', params: {} } },
      { color: '#0000ff' },
    ]))!;
    expect(got.splice!.inputBySlot).toEqual([-1, -1, -1, -1, 0]);
    expect(got.spliceInputs).toHaveLength(1);
  });

  it('cycles fewer slots than the count, as a graph splice does', () => {
    const got = resolveSpliceGenerator(device('splice', { count: 4 }, COLOUR_SLOTS))!;
    expect(got.splice!.colors).toEqual(['#ff0000', '#0000ff', '#ff0000', '#0000ff']);
  });

  it('resolves to null when every slot is blank, for a foreign Style, and for a non-splice kind', () => {
    expect(resolveSpliceGenerator(device('splice', {}, [{}, { muted: true, color: '#fff000' }]))).toBeNull();
    expect(resolveSpliceGenerator(device('splice', {}, []))).toBeNull();
    expect(resolveSpliceGenerator({ ...device('splice', {}, COLOUR_SLOTS), style: 'radial' })).toBeNull();
    expect(resolveSpliceGenerator({ kind: 'wave', style: '', params: {} })).toBeNull();
    expect(resolveSpliceGenerator({ ...device('slice', {}, COLOUR_SLOTS), style: 'slice' })).not.toBeNull();
  });
});

describe('Splice / Slice in the Generator registry', () => {
  it('lists both, and resolves them through resolveGenerator', () => {
    const ids = listGenerators().map((g) => g.id);
    expect(ids).toContain('splice');
    expect(ids).toContain('slice');
    expect(getGeneratorDef('splice')!.description).toBeTruthy();
    expect(resolveGenerator(device('splice', { count: 2 }, COLOUR_SLOTS))!.splice!.count).toBe(2);
    expect(resolveGenerator(device('slice', {}, COLOUR_SLOTS))!.splice!.space).toBeDefined();
  });

  it('gives each a card param spec whose defaults resolve to the machinery defaults', () => {
    for (const kind of ['splice', 'slice'] as const) {
      const spec = spliceGeneratorParamSpec(kind);
      const defaults = Object.fromEntries(spec.map((p) => [p.key, p.default]));
      const fromDefaults = resolveSpliceGenerator(device(kind, defaults, COLOUR_SLOTS))!;
      const fromNothing = resolveSpliceGenerator(device(kind, {}, COLOUR_SLOTS))!;
      expect(fromDefaults.splice, kind).toEqual(fromNothing.splice);
    }
    expect(spliceGeneratorParamSpec('slice').some((p) => p.key === 'partition')).toBe(false);
    expect(spliceGeneratorParamSpec('wave')).toEqual([]);
  });

  it('maps every device param key onto a node field the splice machinery reads', () => {
    const n = spliceDeviceNode(device('splice', RICH_PARAMS, COLOUR_SLOTS));
    for (const [k, v] of Object.entries(RICH_NODE)) expect(n[k as keyof GraphNode], k).toEqual(v);
  });
});

// ---- Render oracle: Effect path vs graph splice node through the real engine -------------

/** 4 pixels per hoop, 2 hoops per drum, 2 drums → 16 pixels. */
function testModel(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'kick', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'snare', diameterIn: 10, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  }));
}

const transport = (now: number): TransportState => {
  const beat = (now / 60000) * 120;
  return { timeMs: now, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
};

/**
 * Fire once at t=0 and sample the frame at each of `sampleMs`. `prepare` runs after setShow,
 * before the hit (the Effect path uses it to stand in for the pending engine hook).
 */
function framesOf(show: Show, hit: InputEvent, sampleMs: readonly number[], prepare?: (engine: RenderEngine) => void): number[][] {
  const engine = createVoiceBusEngine();
  engine.setModel(testModel());
  engine.setShow(show);
  prepare?.(engine);
  engine.applyInput(hit);
  const out: number[][] = [];
  let t = 0;
  for (const at of sampleMs) {
    while (t < at) {
      t += 5;
      engine.tick(t, 5, transport(t));
    }
    out.push(Array.from(engine.frame()).map((v) => Math.round(v * 1e5) / 1e5));
  }
  return out;
}

const SAMPLES = [20, 60, 150, 260, 400, 520, 700] as const;

/** A graph splice node on kick's '' pad, with the splice envelope defaults (10 / 400 / 300). */
function graphFrames(splices: SpliceDef[], over: Partial<GraphNode>, effects: EffectDef[] = []): number[][] {
  const graph: TriggerGraph = {
    version: 3,
    nodes: [node('trigger', 'trigger'), node('splice', 's1', { splices, ...over }), node('output', 'output')],
    edges: [{ id: 'e0', from: 'trigger', to: 's1' }, { id: 'e1', from: 's1', to: 'output' }],
  };
  const show: Show = {
    ...emptyShow(),
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }],
    graphs: { [padKey('kick', '')]: graph },
    effects,
  };
  return framesOf(show, { kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs: 0 }, SAMPLES);
}

/** The equivalent Splice Effect: kit target, amp matching the splice envelope defaults. */
function effectFrames(gen: GeneratorDevice): number[][] {
  const effect: Effect = parseEffect({
    id: 'fx', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: gen,
    amp: { attackMs: 10, decayMs: 0, sustainLevel: 1, length: { ms: 410 }, releaseMs: 300 },
    target: { kind: 'kit' },
  });
  const show: Show = { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections: [{ id: 's', name: 's', slots: {}, effects: [effect] }] }] };
  // Stand-in for the engine hook reported for merge: the engine lazily builds only the HOST's
  // chain EffectDef; the hook also ensures one per splice member (see the commit report).
  const ensureMemberDefs = (engine: RenderEngine): void => {
    const action = effectPlayAction(effect, { velocity: 1, sourceDrumId: 'kick', bpm: 120, layerOrder: 0 })!;
    const defs = (engine as unknown as { chainEffects: Map<string, EffectDef> }).chainEffects;
    for (const m of action.spliceInputs ?? []) defs.set(m.effectId, chainEffectDef(m.effectId.slice(m.effectId.indexOf(':') + 1))!);
  };
  return framesOf(show, { kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1, timeMs: 0 }, SAMPLES, ensureMemberDefs);
}

const lit = (frames: number[][]): number => frames.reduce((s, f) => s + f.reduce((a, b) => a + b, 0), 0);

const WAVE_DEF: EffectDef = { ...chainEffectDef('chase-bands')!, id: 'wave-fx', busId: 'base' };

/**
 * Compare an Effect render against its graph oracle when one slot hosts a nested Wave.
 *
 * Pixels outside the Wave's band must be identical at every sample. Inside it the ONE
 * documented delta applies: on the Effect path the amp envelope owns the level (S01 — the
 * resolver always emits a life curve, which the compositor hands to every splice member), so
 * a nested generator's own natural decay is off, while the graph member still decays by
 * itself. So the Wave band is never dimmer on the Effect path, and it is identical until the
 * nested generator has decayed visibly.
 */
function expectSameExceptNestedDecay(effect: number[][], graph: number[][], waveBandDark: number[][]): void {
  expect(lit(graph)).toBeGreaterThan(0);
  effect.forEach((frame, s) => {
    frame.forEach((v, i) => {
      const label = `sample ${SAMPLES[s]}ms channel ${i}`;
      const inWaveBand = waveBandDark[s]![i] === 0;
      if (inWaveBand) expect(v, label).toBeGreaterThanOrEqual(graph[s]![i]!);
      else expect(v, label).toBe(graph[s]![i]);
    });
  });
}

describe('Splice Effect renders like the graph splice node', () => {
  it('two colour slots and a nested Wave, held still', () => {
    const over: Partial<GraphNode> = { spliceCount: 3, splicePartition: 'hoop' };
    const graph = graphFrames([{ color: '#ff0000' }, { color: '#0000ff' }, { effectId: 'wave-fx', params: { speed: 2 } }], over, [WAVE_DEF]);
    const waveBandDark = graphFrames([{ color: '#ff0000' }, { color: '#0000ff' }, {}], over);
    const effect = effectFrames(device('splice', { count: 3, partition: 'hoop' }, [
      { color: '#ff0000' }, { color: '#0000ff' }, { generator: { kind: 'wave', style: 'chase', params: { speed: 2 } } },
    ]));
    expectSameExceptNestedDecay(effect, graph, waveBandDark);
    // Through the attack and hold, before the nested chase has decayed visibly: bit-identical.
    expect(effect.slice(0, 3)).toEqual(graph.slice(0, 3));
  });

  it('MOVE AROUND — a stepping chase, with a nested Wave', () => {
    const over: Partial<GraphNode> = { spliceCount: 3, spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100 };
    const graph = graphFrames([{ color: '#ff0000' }, { color: '#0000ff' }, { effectId: 'wave-fx' }], over, [WAVE_DEF]);
    const waveBandDark = graphFrames([{ color: '#ff0000' }, { color: '#0000ff' }, {}], over);
    const effect = effectFrames(device('splice', { count: 3, chase: 'step', rateMode: 'time', rateMs: 100 }, [
      { color: '#ff0000' }, { color: '#0000ff' }, { generator: { kind: 'wave', style: 'chase', params: {} } },
    ]));
    expectSameExceptNestedDecay(effect, graph, waveBandDark);
  });

  it('MOVE AROUND — a smooth, rotated chase of colour slots is bit-identical', () => {
    const over: Partial<GraphNode> = { spliceCount: 2, spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 150, spliceRotationDeg: 45 };
    const graph = graphFrames(COLOUR_DEFS, over);
    const effect = effectFrames(device('splice', { count: 2, chase: 'smooth', rateMode: 'time', rateMs: 150, rotationDeg: 45 }, COLOUR_SLOTS));
    expect(lit(graph)).toBeGreaterThan(0);
    expect(effect).toEqual(graph);
  });

  it('MOVE THROUGH — a hoop and drum cascade with dark waiting units is bit-identical', () => {
    const over: Partial<GraphNode> = {
      spliceCount: 2, spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 200,
      spliceOffsetMode: 'time', spliceOffsetMs: 80, spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 150,
      spliceWaitMode: 'dark',
    };
    const graph = graphFrames(COLOUR_DEFS, over);
    const effect = effectFrames(device('splice', {
      count: 2, chase: 'smooth', rateMode: 'time', rateMs: 200, offsetMode: 'time', offsetMs: 80,
      drumOffsetMode: 'time', drumOffsetMs: 150, waitMode: 'dark',
    }, COLOUR_SLOTS));
    expect(lit(graph)).toBeGreaterThan(0);
    expect(effect).toEqual(graph);
  });

  it('a Slice Effect renders like the graph slice node', () => {
    const graph = graphFrames(COLOUR_DEFS, { kind: 'slice', spliceCount: 2, sliceAxis: 'x', spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 120 });
    const effect = effectFrames(device('slice', { count: 2, axis: 'x', chase: 'step', rateMode: 'time', rateMs: 120 }, COLOUR_SLOTS));
    expect(lit(graph)).toBeGreaterThan(0);
    expect(effect).toEqual(graph);
  });
});

