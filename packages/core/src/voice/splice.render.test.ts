import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type SpliceDef, type TriggerGraph } from './types';

/* Splice end to end: a hit fires a splice node, the engine spawns ONE composite voice, and
   the compositor reveals each splice through its own band of pixels. These drive the real
   engine (eval → voice pool → compositor) rather than the pure band maths, because the parts
   worth pinning here are the ones the pure tests structurally cannot see: that a colour with
   no authored EffectDef still renders, that band N shows splice N, and that the chase moves. */

/** 4 pixels per hoop, 2 hoops per drum, 2 drums → 16 pixels, hoops at 0-3, 4-7, 8-11, 12-15. */
function testModel(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 10, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

const buses = (): Bus[] => [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];

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

function spliceGraph(splices: SpliceDef[], over: Partial<GraphNode> = {}): TriggerGraph {
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger'),
      node('splice', 's1', { splices, spliceCount: splices.length, splicePartition: 'hoop', ...over }),
      node('output', 'output'),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 's1' },
      { id: 'e1', from: 's1', to: 'output' },
    ],
  };
}

function show(graph: TriggerGraph, effects: EffectDef[] = []): Show {
  return { buses: buses(), graphs: { [padKey('kick', '')]: graph }, sections: [], effects, presets: [] };
}

const transport = (now: number, beat = 0, bpm = 120): TransportState => ({
  timeMs: now,
  beat,
  bar: Math.floor(beat / 4),
  beatInBar: beat - Math.floor(beat / 4) * 4,
  bpm,
  beatsPerBar: 4,
  playing: true,
});

const hit = (timeMs = 0): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });

/** Fire the graph and sample the frame at `atMs` (past the 10ms attack, so level is 1). */
function render(graph: TriggerGraph, effects: EffectDef[] = [], atMs = 40): { rgb: (i: number) => [number, number, number]; model: PixelModel } {
  const model = testModel();
  const engine = createVoiceBusEngine();
  engine.setModel(model);
  engine.setShow(show(graph, effects));
  engine.applyInput(hit(0));
  engine.tick(5, 5, transport(5));
  engine.tick(atMs, atMs - 5, transport(atMs, (atMs / 60000) * 120));
  const frame = engine.frame();
  return { model, rgb: (i) => [frame[i * 4]!, frame[i * 4 + 1]!, frame[i * 4 + 2]!] };
}

const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];
const DARK: [number, number, number] = [0, 0, 0];

function expectRgb(actual: [number, number, number], expected: [number, number, number], label: string): void {
  expect(actual[0], `${label} r`).toBeCloseTo(expected[0], 2);
  expect(actual[1], `${label} g`).toBeCloseTo(expected[1], 2);
  expect(actual[2], `${label} b`).toBeCloseTo(expected[2], 2);
}

describe('splice — colour splices', () => {
  it('renders a colour splice with no authored effect at all (the engine hosts the fill)', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }]));
    // 2 splices over each 4-pixel hoop → pixels 0-1 red, 2-3 blue, repeating on every hoop.
    expectRgb(rgb(0), RED, 'hoop1 band1 px0');
    expectRgb(rgb(1), RED, 'hoop1 band1 px1');
    expectRgb(rgb(2), BLUE, 'hoop1 band2 px2');
    expectRgb(rgb(3), BLUE, 'hoop1 band2 px3');
  });

  it('cuts EVERY hoop of the kit, not just the struck drum’s first one', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }]));
    for (const hoopStart of [0, 4, 8, 12]) {
      expectRgb(rgb(hoopStart), RED, `hoop@${hoopStart} band1`);
      expectRgb(rgb(hoopStart + 2), BLUE, `hoop@${hoopStart} band2`);
    }
  });

  it('leaves a blank splice dark — you see through it, not a black fill of the effect', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, {}]));
    expectRgb(rgb(0), RED, 'lit splice');
    expectRgb(rgb(2), DARK, 'blank splice');
    expectRgb(rgb(3), DARK, 'blank splice');
  });

  it('mutes a splice without losing what is authored on it', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff', muted: true }]));
    expectRgb(rgb(0), RED, 'unmuted');
    expectRgb(rgb(2), DARK, 'muted');
  });

  it('spawns nothing at all when every splice is blank', () => {
    const model = testModel();
    const engine = createVoiceBusEngine();
    engine.setModel(model);
    engine.setShow(show(spliceGraph([{}, { muted: true }])));
    engine.applyInput(hit(0));
    engine.tick(5, 5, transport(5));
    engine.tick(40, 35, transport(40));
    expect(engine.stats().voices).toHaveLength(0);
  });

  it('cuts each drum whole under the drum partition, and the scope once under scope', () => {
    const perDrum = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], { splicePartition: 'drum' }));
    // kick = pixels 0-7 → red 0-3, blue 4-7.
    expectRgb(perDrum.rgb(3), RED, 'kick first half');
    expectRgb(perDrum.rgb(4), BLUE, 'kick second half');

    const perScope = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], { splicePartition: 'scope' }));
    // whole kit = pixels 0-15 → red 0-7, blue 8-15.
    expectRgb(perScope.rgb(7), RED, 'kit first half');
    expectRgb(perScope.rgb(8), BLUE, 'kit second half');
  });
});

describe('splice — chase', () => {
  const chasing = (over: Partial<GraphNode>, atMs: number) =>
    render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], over), [], atMs);

  it('holds still with the chase off, however long the voice runs', () => {
    const held = chasing({ spliceChase: 'off' }, 400);
    expectRgb(held.rgb(0), RED, 'band1 at 400ms');
    expectRgb(held.rgb(2), BLUE, 'band2 at 400ms');
  });

  it('step chase swaps which splice each band shows, one splice per interval', () => {
    // Voice is born at t=5, so a 100ms interval steps at ages 100/200/… → frame times 105/205.
    const before = chasing({ spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100 }, 80);
    expectRgb(before.rgb(0), RED, 'band1 before the first step');

    const after = chasing({ spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100 }, 150);
    expectRgb(after.rgb(0), BLUE, 'band1 after one step');
    expectRgb(after.rgb(2), RED, 'band2 after one step');
  });

  it('smooth chase slides the cut around the hoop and wraps', () => {
    // One lap of a 4-pixel hoop per 100ms → at age 25ms the pattern has slid exactly 1 pixel.
    const slid = chasing({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 100 }, 30);
    expectRgb(slid.rgb(0), BLUE, 'px0 now shows the wrapped tail of the blue band');
    expectRgb(slid.rgb(1), RED, 'red band slid one pixel along');
    expectRgb(slid.rgb(2), RED, 'red band slid one pixel along');
    expectRgb(slid.rgb(3), BLUE, 'blue band slid one pixel along');
  });

  it('stagger jumps the cut by the authored pixels, and holds between jumps', () => {
    const staggered = (atMs: number) =>
      chasing({ spliceChase: 'stagger', spliceRateMode: 'time', spliceRateMs: 100, spliceIncrementPx: 1 }, atMs);
    // 4-pixel hoops, 2 splices → red 0-1, blue 2-3 at rest. Voice born at t=5, so the first
    // jump lands at frame time 105.
    expectRgb(staggered(80).rgb(0), RED, 'before the first jump');
    expectRgb(staggered(90).rgb(0), RED, 'still before it — a stagger does not creep');
    expectRgb(staggered(150).rgb(0), BLUE, 'after one 1px jump, px0 shows the wrapped blue tail');
    expectRgb(staggered(150).rgb(1), RED, 'the red band has moved one pixel along');
    expectRgb(staggered(190).rgb(1), RED, 'and holds there for the rest of the interval');
    expectRgb(staggered(250).rgb(2), RED, 'two jumps in, red has moved two pixels');
  });

  it('stagger moves the same distance on every hoop, whatever its length', () => {
    const { rgb } = chasing({ spliceChase: 'stagger', spliceRateMode: 'time', spliceRateMs: 100, spliceIncrementPx: 1 }, 150);
    // Every hoop of both drums has jumped by exactly one pixel — an authored increment, not a lap.
    for (const hoopStart of [0, 4, 8, 12]) {
      expectRgb(rgb(hoopStart), BLUE, `hoop@${hoopStart} wrapped tail`);
      expectRgb(rgb(hoopStart + 1), RED, `hoop@${hoopStart} moved one pixel`);
    }
  });

  it('stagger with a zero increment renders exactly like a held cut', () => {
    const held = chasing({ spliceChase: 'off' }, 400);
    const frozen = chasing({ spliceChase: 'stagger', spliceRateMode: 'time', spliceRateMs: 100, spliceIncrementPx: 0 }, 400);
    for (let i = 0; i < 16; i++) expectRgb(frozen.rgb(i), held.rgb(i), `pixel ${i}`);
  });

  it('runs the chase backwards on a negative direction', () => {
    const forward = chasing({ spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100, spliceDirection: 1 }, 150);
    const backward = chasing({ spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100, spliceDirection: -1 }, 150);
    // With two splices a single step looks the same either way, so compare at THREE splices:
    const three = (dir: 1 | -1) =>
      render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }, { color: '#00ff00' }], {
        spliceChase: 'step',
        spliceRateMode: 'time',
        spliceRateMs: 100,
        spliceDirection: dir,
        splicePartition: 'scope',
      }), [], 150);
    expectRgb(forward.rgb(0), BLUE, 'forward one step');
    expectRgb(backward.rgb(0), BLUE, 'backward one step (2 splices is symmetric)');
    // 16 kit pixels / 3 splices → bands 0-5, 6-11, 11-16; band 0 shows slot −1 vs +1.
    expectRgb(three(1).rgb(0), [0, 1, 0], 'forward: band 0 shows the previous splice');
    expectRgb(three(-1).rgb(0), BLUE, 'backward: band 0 shows the next splice');
  });
});

describe('splice — effects inside a splice', () => {
  /** A real generator-backed effect, as the gallery would supply it. */
  const litEffect = (id: string): EffectDef => ({
    id,
    name: id,
    generatorId: 'breathing-kit', // a continuous kit-wide fill: every pixel lit, so masking is what we read
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'B', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 5000,
    releaseMs: 100,
  });

  it('shows an effect only inside its own splice, leaving the others to their own content', () => {
    const { rgb } = render(spliceGraph([{ effectId: 'fx' }, {}]), [litEffect('fx')]);
    const [r, g, b] = rgb(0);
    expect(r + g + b, 'effect splice is lit').toBeGreaterThan(0);
    expectRgb(rgb(2), DARK, 'blank splice stays dark even though the effect rendered kit-wide');
  });

  it('tints an effect splice toward its colour, and leaves a colourless one alone', () => {
    const tinted = render(spliceGraph([{ effectId: 'fx', color: '#ff0000' }, { effectId: 'fx' }]), [litEffect('fx')]);
    const [tr, tg, tb] = tinted.rgb(0);
    const [ur, ug, ub] = tinted.rgb(2);
    expect(tg, 'tinted splice loses its green').toBeCloseTo(0, 2);
    expect(tb, 'tinted splice loses its blue').toBeCloseTo(0, 2);
    expect(tr, 'tinted splice keeps the effect brightness').toBeCloseTo(Math.max(ur, ug, ub), 2);
    expect(ug + ub, 'untinted splice keeps the effect colour').toBeGreaterThan(0);
  });

  it('mixes colour splices and effect splices in one node', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { effectId: 'fx' }]), [litEffect('fx')]);
    expectRgb(rgb(0), RED, 'colour splice');
    const [r, g, b] = rgb(2);
    expect(r + g + b, 'effect splice').toBeGreaterThan(0);
    expect(g + b, 'effect splice is not the flat red').toBeGreaterThan(0);
  });

  it('is deterministic: the same show and the same hits render the same frame twice', () => {
    const graph = spliceGraph([{ color: '#ff0000' }, { effectId: 'fx' }, {}], { spliceJitter: 0.7, spliceChase: 'smooth', spliceRateMs: 90, spliceRateMode: 'time' });
    const a = render(graph, [litEffect('fx')], 123);
    const b = render(graph, [litEffect('fx')], 123);
    for (let i = 0; i < 16; i++) expectRgb(a.rgb(i), b.rgb(i), `pixel ${i}`);
  });
});
