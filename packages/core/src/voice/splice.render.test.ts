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

/** Advance the engine to `toMs` in small steps, starting from `fromMs`. */
function runTo(engine: ReturnType<typeof createVoiceBusEngine>, toMs: number, fromMs = 0): void {
  const STEP = 5;
  for (let t = fromMs + STEP; t < toMs; t += STEP) engine.tick(t, STEP, transport(t, (t / 60000) * 120));
  engine.tick(toMs, STEP, transport(toMs, (toMs / 60000) * 120));
}

/** Fire the graph and sample the frame at `atMs` (past the 10ms attack, so level is 1). */
function render(graph: TriggerGraph, effects: EffectDef[] = [], atMs = 40): { rgb: (i: number) => [number, number, number]; model: PixelModel } {
  const model = testModel();
  const engine = createVoiceBusEngine();
  engine.setModel(model);
  engine.setShow(show(graph, effects));
  engine.applyInput(hit(0));
  // Tick in small steps rather than one giant dt: the envelope advance integrates against dt,
  // so a single 300ms jump overshoots the hold and reports a voice that is really still lit.
  runTo(engine, atMs);
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
    runTo(engine, 40);
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

describe('splice — cascade offset across units', () => {
  const cascading = (over: Partial<GraphNode>, atMs: number) =>
    render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], {
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 100,
      ...over,
    }), [], atMs);

  it('starts each hoop later than the one before it, so the chase climbs the drum', () => {
    // Offset 200ms, chase interval 100ms. Voice born at t=5, so at frame 150 the first hoop
    // has aged 145ms (one step) while the second is still waiting out its 200ms head start.
    const { rgb } = cascading({ spliceOffsetMode: 'time', spliceOffsetMs: 200, spliceOrder: 'up' }, 150);
    expectRgb(rgb(0), BLUE, 'hoop 1 has stepped');
    expectRgb(rgb(4), RED, 'hoop 2 has not started — it holds the cut, it does not go dark');
  });

  it('a waiting hoop is LIT and still, never blank', () => {
    const { rgb } = cascading({ spliceOffsetMode: 'time', spliceOffsetMs: 5000, spliceOrder: 'up' }, 150);
    expectRgb(rgb(4), RED, 'hoop 2 shows its resting cut');
    expectRgb(rgb(6), BLUE, 'both its splices are lit, just not moving');
  });

  it('reverses which hoop leads on a down order', () => {
    const down = cascading({ spliceOffsetMode: 'time', spliceOffsetMs: 200, spliceOrder: 'down' }, 150);
    expectRgb(down.rgb(4), BLUE, 'the TOP hoop leads');
    expectRgb(down.rgb(0), RED, 'and the bottom one waits');
  });

  it('runs the cascade per drum, so hoop 1 of every drum fires together', () => {
    const { rgb } = cascading({ spliceOffsetMode: 'time', spliceOffsetMs: 200, spliceOrder: 'up' }, 150);
    expectRgb(rgb(0), BLUE, 'kick hoop 1');
    expectRgb(rgb(8), BLUE, 'snare hoop 1 — same position in its own drum, same start');
    expectRgb(rgb(12), RED, 'snare hoop 2 waits exactly like the kick’s');
  });

  it('moves every unit together when no offset is set — the previous behaviour', () => {
    const together = cascading({ spliceOrder: 'down' }, 150);
    expectRgb(together.rgb(0), BLUE, 'hoop 1');
    expectRgb(together.rgb(4), BLUE, 'hoop 2 moved with it');
  });

  it('resolves a bpm-synced offset like every other splice timing', () => {
    // 1/8 at 120bpm = 250ms, so at frame 150 the second hoop has not started.
    const { rgb } = cascading({ spliceOffsetMode: 'beats', spliceOffsetDivision: '1/8' }, 150);
    expectRgb(rgb(0), BLUE, 'hoop 1 has stepped');
    expectRgb(rgb(4), RED, 'hoop 2 is inside its 250ms head start');
  });
});

describe('splice — scope', () => {
  it('cuts the whole kit by default', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }]));
    for (const hoopStart of [0, 4, 8, 12]) expectRgb(rgb(hoopStart), RED, `hoop@${hoopStart}`);
  });

  it('cuts only the drum it is scoped to, leaving the rest of the kit dark', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], { scope: 'drum', targetId: 'snare' }));
    expectRgb(rgb(0), DARK, 'kick untouched');
    expectRgb(rgb(4), DARK, 'kick untouched');
    expectRgb(rgb(8), RED, 'snare hoop 1 cut');
    expectRgb(rgb(12), RED, 'snare hoop 2 cut');
  });

  it('cuts a single hoop when scoped to one', () => {
    const { rgb } = render(spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], { scope: 'hoop', targetId: 'snare#2' }));
    expectRgb(rgb(8), DARK, 'snare hoop 1 untouched');
    expectRgb(rgb(12), RED, 'snare hoop 2 cut');
    expectRgb(rgb(14), BLUE, 'and cut into its splices');
  });
});

describe('splice — layer polyphony (sustain vs cut)', () => {
  /** Trigger → sequence → two splice nodes on `busId`, the shape a sequencer-of-splices takes. */
  function sequencedGraph(busId: string): TriggerGraph {
    const splice = (id: string, colour: string, y: number) =>
      node('splice', id, {
        y,
        busId,
        splices: [{ color: colour }],
        spliceCount: 1,
        splicePartition: 'hoop',
        spliceHoldMs: 4000,
        spliceReleaseMs: 200,
      });
    return {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('sequence', 'seq'), splice('a', '#ff0000', 0), splice('b', '#0000ff', 100), node('output', 'output')],
      edges: [
        { id: 'e0', from: 'trigger', to: 'seq' },
        { id: 'e1', from: 'seq', to: 'a' },
        { id: 'e2', from: 'seq', to: 'b' },
        { id: 'e3', from: 'a', to: 'output' },
        { id: 'e4', from: 'b', to: 'output' },
      ],
    };
  }

  /** Two hits 500ms apart — the sequence fires splice A then splice B. */
  function twoSteps(busId: string, polyphony: 'mono' | 'poly'): number {
    const model = testModel();
    const engine = createVoiceBusEngine();
    engine.setModel(model);
    engine.setShow({
      buses: [{ id: busId, name: busId, polyphony, crossfadeMs: 200 }],
      graphs: { [padKey('kick', '')]: sequencedGraph(busId) },
      sections: [],
      effects: [],
      presets: [],
    });
    engine.applyInput(hit(0));
    runTo(engine, 500);
    engine.applyInput(hit(500));
    runTo(engine, 560, 500);
    return engine.stats().voices.filter((v) => !v.releasing).length;
  }

  it('sustains both splices on a poly layer — the earlier hoop keeps burning', () => {
    expect(twoSteps('trigger', 'poly')).toBe(2);
  });

  it('cuts the previous splice on a mono layer, even though it came from a different node', () => {
    // This is the case a per-node "cut" flag could never express: the two voices come from
    // DIFFERENT splice nodes, so only a layer-level rule can end one when the other starts.
    expect(twoSteps('base', 'mono')).toBe(1);
  });

  it('a colour-only splice lands on a poly layer, not blindly on the first one', () => {
    // The reported bug: the reserved fill def took `buses[0]`, which is mono in the real kit,
    // so a sequencer cycling splice nodes cut each hoop off as it moved on.
    const model = testModel();
    const engine = createVoiceBusEngine();
    engine.setModel(model);
    engine.setShow({
      buses: [
        { id: 'base', name: 'Base', polyphony: 'mono', crossfadeMs: 900 },
        { id: 'trigger', name: 'Trigger', polyphony: 'poly', crossfadeMs: 240 },
      ],
      // No busId on the splice nodes at all → they fall back to the fill def's layer.
      graphs: { [padKey('kick', '')]: sequencedGraph('') },
      sections: [],
      effects: [],
      presets: [],
    });
    engine.applyInput(hit(0));
    runTo(engine, 500);
    engine.applyInput(hit(500));
    runTo(engine, 560, 500);
    expect(engine.stats().voices.filter((v) => !v.releasing)).toHaveLength(2);
  });
});

describe('splice — envelope', () => {
  /** Total lit brightness of the frame — a proxy for "are the lights still up". */
  const litSum = (rgb: (i: number) => [number, number, number]) => {
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += rgb(i)[0] + rgb(i)[1] + rgb(i)[2];
    return sum;
  };

  it('holds the lights up for the authored time, then fades', () => {
    const graph = spliceGraph([{ color: '#ff0000' }], { spliceAttackMs: 10, spliceHoldMs: 600, spliceReleaseMs: 200 });
    expect(litSum(render(graph, [], 300).rgb), 'inside the hold').toBeGreaterThan(0);
    expect(litSum(render(graph, [], 600).rgb), 'still inside the hold').toBeGreaterThan(0);
    expect(litSum(render(graph, [], 1200).rgb), 'past hold + fade').toBe(0);
  });

  it('a longer hold keeps them up past the point a short one has gone dark', () => {
    const short = spliceGraph([{ color: '#ff0000' }], { spliceAttackMs: 10, spliceHoldMs: 50, spliceReleaseMs: 20 });
    const long = spliceGraph([{ color: '#ff0000' }], { spliceAttackMs: 10, spliceHoldMs: 4000, spliceReleaseMs: 20 });
    expect(litSum(render(short, [], 500).rgb), 'short one is done').toBe(0);
    expect(litSum(render(long, [], 500).rgb), 'long one is still up').toBeGreaterThan(0);
  });
});

describe('splice — restart vs continuous', () => {
  const motion = (mode: 'restart' | 'continuous' | 'latched', over: Partial<GraphNode> = {}) =>
    spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], {
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 100,
      spliceHoldMs: 60000,
      spliceMotionMode: mode,
      ...over,
    });

  /** Fire once at t=0, again at `secondHitMs`, and sample `atMs`. */
  function reHit(graph: TriggerGraph, secondHitMs: number, atMs: number): (i: number) => [number, number, number] {
    const model = testModel();
    const engine = createVoiceBusEngine();
    engine.setModel(model);
    engine.setShow(show(graph, []));
    engine.applyInput(hit(0));
    runTo(engine, secondHitMs);
    engine.applyInput(hit(secondHitMs));
    runTo(engine, atMs, secondHitMs);
    const frame = engine.frame();
    return (i) => [frame[i * 4]!, frame[i * 4 + 1]!, frame[i * 4 + 2]!];
  }

  it('restart puts the movement back to its starting position on every hit', () => {
    // Second hit at 1050ms, sampled 50ms later: a restarted chase has taken no step yet.
    expectRgb(reHit(motion('restart'), 1050, 1100)(0), RED, 'back at step 0');
  });

  it('continuous picks up where the last hit left off instead of resetting', () => {
    // Same instant, same graph — only the mode differs. The free clock is 1100ms in (11 steps,
    // odd → the other splice), while a restarted one is 50ms in (0 steps).
    expectRgb(reHit(motion('continuous'), 1050, 1100)(0), BLUE, 'eleven steps in, unbroken by the hit');
    expectRgb(reHit(motion('restart'), 1050, 1100)(0), RED, 'and the same moment restarted');
  });

  // A short hold means each hit banks ~170ms of lit time; at a 150ms interval that is one
  // step, while a restarted chase at the same instant has taken none.
  const SHORT = { spliceHoldMs: 100, spliceReleaseMs: 20, spliceRateMs: 150 };

  it('latched resumes on the step it banked, where restart goes back to zero', () => {
    expectRgb(reHit(motion('latched', SHORT), 1050, 1090)(0), BLUE, 'carries on from the banked step');
    expectRgb(reHit(motion('restart', SHORT), 1050, 1090)(0), RED, 'back to the start');
  });

  it('latched ignores time spent dark, where continuous does not', () => {
    // Two gaps that differ ONLY in how long the kit sat dark. Latched must land identically
    // (dark time is not movement); continuous must not (its clock ran the whole time) — the
    // second assertion is what proves the first is testing something real.
    const latchedShort = reHit(motion('latched', SHORT), 500, 540)(0);
    const latchedLong = reHit(motion('latched', SHORT), 600, 640)(0);
    expectRgb(latchedLong, latchedShort, 'same position after either gap');

    const contShort = reHit(motion('continuous', SHORT), 500, 540)(0);
    const contLong = reHit(motion('continuous', SHORT), 600, 640)(0);
    expect(contShort[0]).not.toBeCloseTo(contLong[0], 2);
  });

  it('restart is the default, so an un-authored splice behaves as it always did', () => {
    const graph = spliceGraph([{ color: '#ff0000' }, { color: '#0000ff' }], {
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 100,
      spliceHoldMs: 60000,
    });
    expectRgb(reHit(graph, 1050, 1100)(0), RED, 'no step taken since the hit');
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
