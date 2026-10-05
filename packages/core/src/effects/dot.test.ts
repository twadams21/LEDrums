/* Dot (Tim, 2026-10-03): small pulses that travel round hoops, up drums, across the kit or through
   space — or sit still and twinkle — each with its own Lifespan. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { resolveGenerator } from '../effect-chain/generators';
import { defaultParams, type ResolvedParams } from './types';
import { tryGetEffect } from './registry';
import { customDrumOrder, dot, dotCap, dotSpanMs } from './impl/dot';

/** Two drums of three 40-pixel hoops, 600mm apart. */
function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 40, hoopCount: 3, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums: ['a', 'b'].map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, pixelsPerHoop: 40, origin: { x: i * 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

const M = model();

/** Play one voice for `ms`, frame by frame, returning the last frame and the dots' state. */
function play(params: ResolvedParams, ms: number, opts: { drum?: string; velocity?: number; seed?: number; seq?: number } = {}) {
  // No fade-in unless a test asks: most checks read the very first frames.
  const p = { ...defaultParams(dot.paramSpec), fade: 0, ...params };
  const state = dot.createState!(M, opts.seed ?? 7);
  let fb = new Framebuffer(M.pixelCount);
  for (let t = 0; t <= ms; t += 10) {
    fb = new Framebuffer(M.pixelCount);
    const ctx: RenderContext = {
      model: M, timeMs: t, dt: t === 0 ? 0 : 10,
      transport: { timeMs: t, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
      triggers: [{ seq: opts.seq ?? 1, drumId: opts.drum ?? 'a', note: 100, velocity: opts.velocity ?? 1, timeMs: 0, ageMs: t }],
    };
    dot.render(ctx, p, fb, state);
  }
  return { fb, state };
}

function lit(fb: Framebuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) if (fb.rgba[i * 4 + 3]! > 0.004) out.push(i);
  return out;
}

function brightest(fb: Framebuffer): number {
  let best = -1;
  let bestA = 0;
  for (let i = 0; i < fb.pixelCount; i++) if (fb.rgba[i * 4 + 3]! > bestA) { bestA = fb.rgba[i * 4 + 3]!; best = i; }
  return best;
}

const FRAMES = dot.createState!(M, 1).frames;
/** How many pixels on from its hoop's 0° (the front) a pixel sits, in pixel order. */
function fromFront(pixel: number): number {
  const px = M.pixels[pixel]!;
  const drum = M.drums.findIndex((d) => d.drumId === px.drumId);
  const f = FRAMES[drum]![px.hoopIndex - 1]!;
  return ((((px.indexInHoop - 1 - f.front) * f.sense) % 40) + 40) % 40;
}
/** The Start point (0..1 across the kit's box) that sits on a pixel. */
function spaceAt(pixel: number) {
  const { min, max } = M.bounds;
  const w = M.pixels[pixel]!.world;
  const t = (k: 'x' | 'y' | 'z') => (max[k] - min[k] < 1e-6 ? 0.5 : (w[k] - min[k]) / (max[k] - min[k]));
  return { spaceX: t('x'), spaceY: t('y'), spaceZ: t('z') };
}

const FIXED = { startHoop: 1, startAngle: 0 };
const RANDOM = { randDrum: 1, randHoop: 1, randAngle: 1 };

describe('Dot — registry', () => {
  it('is a registered effect and a Generator kind', () => {
    expect(tryGetEffect('dot')?.description).toBeTruthy();
    expect(resolveGenerator({ kind: 'dot', style: '', params: {} })?.effectId).toBe('dot');
  });
});

describe('Dot — the set point', () => {
  it('a single one-pixel dot starts on the drum you hit, at the front of its bottom hoop', () => {
    const on = lit(play({ speed: 0 }, 0, { drum: 'b' }).fb);
    expect(on).toHaveLength(1);
    expect(M.pixels[on[0]!]).toMatchObject({ drumId: 'b', hoopIndex: 1 });
    expect(fromFront(on[0]!)).toBe(0);
  });

  it('0° is the front of the drum — the pixel nearest the drummer (towards −y)', () => {
    const start = M.drums[0]!.pixelStart;
    let nearest = start;
    for (let i = start; i < start + 40; i++) if (M.pixels[i]!.world.y < M.pixels[nearest]!.world.y) nearest = i;
    expect(fromFront(nearest)).toBe(0);
  });

  it('Start drum, hoop and angle: every dot begins exactly there', () => {
    const on = lit(play({ startDrum: 'b', startHoop: 2, startAngle: 90, speed: 0, count: 3 }, 0, { drum: 'a' }).fb);
    expect(on).toHaveLength(1); // three dots, one pixel
    expect(M.pixels[on[0]!]).toMatchObject({ drumId: 'b', hoopIndex: 2 });
    expect(fromFront(on[0]!)).toBe(10); // 90° of a 40-pixel hoop
    // An older Dot's 1-based drum number still reads.
    expect(M.pixels[lit(play({ startDrum: 2, speed: 0 }, 0, { drum: 'a' }).fb)[0]!]!.drumId).toBe('b');
  });

  it('Spread out shares several dots evenly round the hoop', () => {
    const on = lit(play({ count: 4, spread: true, speed: 0 }, 0).fb).map(fromFront).sort((x, y) => x - y);
    expect(on).toEqual([0, 10, 20, 30]);
  });

  it('Length sets how many pixels it covers; Height spreads it over neighbouring hoops', () => {
    const on = lit(play({ ...FIXED, speed: 0, length: 5, form: 'bar', height: 3, startHoop: 2 }, 0).fb);
    expect(on).toHaveLength(15);
    expect(new Set(on.map((i) => M.pixels[i]!.hoopIndex))).toEqual(new Set([1, 2, 3]));
  });

  it('a Diamond tapers on the outer hoops', () => {
    const { fb } = play({ ...FIXED, speed: 0, length: 7, form: 'diamond', height: 3, startHoop: 2 }, 0);
    const perHoop = (h: number) => lit(fb).filter((i) => M.pixels[i]!.hoopIndex === h).length;
    expect(perHoop(2)).toBeGreaterThan(perHoop(1));
    expect(perHoop(1)).toBe(perHoop(3));
  });
});

describe('Dot — Random: how far each dot strays from the set point', () => {
  const where = (params: Record<string, number>, seed: number) => {
    const px = M.pixels[lit(play({ speed: 0, ...params }, 0, { seed }).fb)[0]!]!;
    return { drum: px.drumId, hoop: px.hoopIndex, at: fromFront(px.id) };
  };
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  it('at 0% every dot begins exactly at the set point', () => {
    expect(new Set(seeds.map((s) => JSON.stringify(where({}, s)))).size).toBe(1);
  });

  it('Hoop strays across the hoops only; Angle round the hoop only; Drum onto other drums', () => {
    const hoops = seeds.map((s) => where({ randHoop: 1 }, s));
    expect(new Set(hoops.map((w) => w.hoop)).size).toBeGreaterThan(1);
    expect(new Set(hoops.map((w) => w.at))).toEqual(new Set([0]));
    const angles = seeds.map((s) => where({ randAngle: 1 }, s));
    expect(new Set(angles.map((w) => w.hoop))).toEqual(new Set([1]));
    expect(new Set(angles.map((w) => w.at)).size).toBeGreaterThan(1);
    expect(new Set(seeds.map((s) => where({ randDrum: 1 }, s).drum))).toEqual(new Set(['a', 'b']));
  });

  it('50% Angle stays within a quarter turn of the set angle', () => {
    for (const s of seeds) {
      const at = where({ randAngle: 0.5 }, s).at;
      expect(Math.min(at, 40 - at)).toBeLessThanOrEqual(10);
    }
  });
});

describe('Dot — moving around', () => {
  it('travels round its hoop at Speed pixels a second, either way', () => {
    const fwd = fromFront(brightest(play({ ...FIXED, speed: 40 }, 250).fb));
    const rev = fromFront(brightest(play({ ...FIXED, speed: 40, direction: 'reverse' }, 250).fb));
    expect([fwd, rev].sort((x, y) => x - y)).toEqual([10, 30]);
  });

  it('Speed per beat follows the tempo (120 bpm = 2 beats a second)', () => {
    expect([10, 30]).toContain(fromFront(brightest(play({ ...FIXED, speed: 5, speedPer: 'beat' }, 1000).fb)));
  });

  it('a Trail lights pixels behind it, not ahead', () => {
    const head = fromFront(brightest(play({ ...FIXED, speed: 40, trail: 4 }, 250).fb));
    const lead = head === 10 ? 1 : -1;
    const at = lit(play({ ...FIXED, speed: 40, trail: 4 }, 250).fb).map(fromFront);
    // Every lit pixel is the head or up to 4 behind it.
    for (const a of at) {
      const back = (((head - a) * lead) % 40 + 40) % 40;
      expect(back).toBeLessThanOrEqual(4);
    }
    expect(at.length).toBeGreaterThan(1);
  });

  it('Ping-pong turns back after Swing pixels', () => {
    const at = (ms: number) => fromFront(brightest(play({ ...FIXED, speed: 40, bounce: 'pingpong', span: 10 }, ms).fb));
    expect([10, 30]).toContain(at(250));
    expect(at(500)).toBe(0);
  });

  it('Bounce: two dots meeting head-on turn back', () => {
    const { state } = play({ ...FIXED, spread: true, count: 2, direction: 'alternate', bounce: 'bounce', speed: 40 }, 400);
    expect(state.dots.map((d) => d.dir)).toEqual([-1, 1]);
  });

  it('Speed 0 holds still: dots stay where they appeared', () => {
    const a = lit(play({ ...RANDOM, count: 5, speed: 0 }, 0).fb);
    const b = lit(play({ ...RANDOM, count: 5, speed: 0 }, 1000).fb);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe('Dot — moving through', () => {
  // Tim, 2026-10-05: "we need to go 2p across for every hoop" — on a drum's LED grid a hoop is two
  // pixel steps, so Speed 4 px/s climbs two hoops a second and 45° goes two pixels round per hoop.
  it('Through a drum at Travel angle 90°: straight up, a hoop per two pixels of travel, none round', () => {
    const d = play({ ...FIXED, speed: 4, through: 'drum' }, 500).state.dots[0]!;
    expect(d.hf).toBeCloseTo(1, 1);
    expect(d.u).toBeCloseTo(d.u0, 5);
  });

  it('at 45° it jumps hoop to hoop, two pixels round each time — never sliding round its own hoop', () => {
    // Tim, 2026-10-05: "don't show the light from the second pixel, just go straight to the pixel on
    // the next hoop … it shouldn't ever move along its same hoop unless the angle is 0 degrees".
    const seen: { hoop: number; at: number }[] = [];
    for (let ms = 0; ms <= 1000; ms += 20) {
      const px = brightest(play({ ...FIXED, speed: 4 * Math.SQRT2, through: 'drum', climb: 45, bounce: 'bounce' }, ms).fb);
      seen.push({ hoop: M.pixels[px]!.hoopIndex, at: fromFront(px) });
    }
    for (let i = 1; i < seen.length; i++) {
      if (seen[i]!.hoop === seen[i - 1]!.hoop) expect(seen[i]!.at).toBe(seen[i - 1]!.at);
    }
    const two = seen.find((s) => s.hoop === 2)!.at;
    expect([2, 38]).toContain(two);
    expect(seen.find((s) => s.hoop === 3)!.at).toBe(two === 2 ? 4 : 36);
  });

  it('at the top hoop Bounce turns back down; Wrap comes back in at the bottom; Reverse heads down; Leave is gone', () => {
    const at = (ms: number, extra: Record<string, string | number>) => play({ ...FIXED, speed: 4, through: 'drum', ...extra }, ms).state.dots[0]!;
    expect(at(1250, { bounce: 'bounce' }).hf).toBeCloseTo(1.5, 1);
    expect(at(1250, { bounce: 'bounce' }).step).toBe(-1);
    expect(at(1400, { bounce: 'wrap' }).hoop).toBe(0);
    expect(at(500, { direction: 'reverse', startHoop: 3 }).hf).toBeCloseTo(1, 1);
    expect(at(1400, { bounce: 'leave' }).gone).toBe(true);
    expect(lit(play({ ...FIXED, speed: 4, through: 'drum', bounce: 'leave' }, 1400).fb)).toHaveLength(0);
  });

  it('crisp by default — one hoop lit mid-climb; Glide blends across the two', () => {
    const hoops = (glide: boolean) => new Set(lit(play({ ...FIXED, speed: 4, through: 'drum', glide }, 250).fb).map((i) => M.pixels[i]!.hoopIndex));
    expect(hoops(false).size).toBe(1);
    expect(hoops(true)).toEqual(new Set([1, 2]));
  });

  it('Travel angle 0° keeps a dot on its hoop, like Through a hoop', () => {
    expect(play({ ...FIXED, speed: 40, through: 'drum', climb: 0 }, 2000).state.dots[0]!.hoop).toBe(0);
  });

  it('Through the kit: up through a drum\'s hoops, then on into the next drum at its bottom hoop', () => {
    const d = play({ ...FIXED, speed: 4, through: 'kit' }, 1500, { drum: 'a' }).state.dots[0]!;
    expect(M.drums[d.drum]!.drumId).toBe('b');
    expect(d.hoop).toBe(0);
  });

  it('Custom kit order: dots begin on its first drum and visit them in that order', () => {
    // Tim, 2026-10-05: "if i make the drum order start with the kick, i am seeing the bottom hoop on
    // tom 1 light up first".
    expect(customDrumOrder(M, 'b,a')).toEqual([1, 0]);
    expect(customDrumOrder(M, 'b')).toEqual([1, 0]); // an unlisted drum follows
    const custom = { ...FIXED, speed: 4, through: 'kit', kitOrder: 'custom', kitList: 'b,a' };
    expect(M.pixels[lit(play(custom, 0, { drum: 'a' }).fb)[0]!]!.drumId).toBe('b'); // hit a, begins on b
    expect(M.drums[play(custom, 1500, { drum: 'a' }).state.dots[0]!.drum]!.drumId).toBe('a');
    expect(play({ ...custom, bounce: 'leave', life: 0 }, 3000, { drum: 'a' }).state.dots[0]!.gone).toBe(true);
  });

  it('Through the kit at 0°: round only, hopping each lap — or after Hop after pixels', () => {
    const { state } = play({ ...FIXED, speed: 40, through: 'kit', climb: 0 }, 1050, { drum: 'a' });
    expect(M.drums[state.dots[0]!.drum]!.drumId).toBe('b');
    const soon = play({ ...FIXED, speed: 40, through: 'kit', climb: 0, hopEvery: 8 }, 250, { drum: 'a' }).state;
    expect(M.drums[soon.dots[0]!.drum]!.drumId).toBe('b');
  });

  it('Through space: starts at the Start point in the kit\'s box and flies along its Heading', () => {
    const { min, max } = M.bounds;
    const at0 = play({ through: 'space', spaceX: 0.25, spaceY: 0.5, spaceZ: 0.5, speed: 0 }, 0).state.dots[0]!.p;
    expect(at0.x).toBeCloseTo(min.x + (max.x - min.x) * 0.25, 3);
    const flown = play({ through: 'space', spaceX: 0.25, heading: 0, elevation: 0, speed: 10 }, 500).state.dots[0]!.p;
    expect(flown.x).toBeGreaterThan(at0.x); // Heading 0°, level: along +X
    expect(flown.y).toBeCloseTo(at0.y, 3);
    expect(flown.z).toBeCloseTo(at0.z, 3);
  });

  it('Through space: Size is the shape\'s size — bigger lights more pixels', () => {
    const on = { through: 'space', speed: 0, ...spaceAt(M.drums[0]!.pixelStart) };
    const count = (radius: number) => lit(play({ ...on, radius }, 0).fb).length;
    expect(count(60)).toBeGreaterThan(count(10));
    expect(count(10)).toBeGreaterThan(0);
  });

  it('Through space: Leave goes out of the kit and is gone, instead of wrapping back in', () => {
    const d = play({ through: 'space', heading: 0, elevation: 0, speed: 200, bounce: 'leave', life: 0 }, 3000).state.dots[0]!;
    expect(d.gone).toBe(true);
  });

  it('Through space: five shapes — a Shell lights fewer pixels than a Ball the same size, a Box more', () => {
    const on = { through: 'space', speed: 0, radius: 60, ...spaceAt(M.drums[0]!.pixelStart) };
    const count = (spaceForm: string) => lit(play({ ...on, spaceForm }, 0).fb).length;
    const ball = count('ball');
    expect(count('shell')).toBeLessThan(ball);
    expect(count('box')).toBeGreaterThanOrEqual(ball);
    for (const f of ['disc', 'beam']) expect(count(f)).toBeGreaterThan(0);
  });

  it('Through space: stays inside the kit, bouncing off its edges', () => {
    const { state } = play({ speed: 200, through: 'space', bounce: 'bounce', direction: 'random', life: 0 }, 5000);
    const { min, max } = M.bounds;
    const p = state.dots[0]!.p;
    for (const k of ['x', 'y', 'z'] as const) {
      expect(p[k]).toBeGreaterThanOrEqual(min[k] - 1e-6);
      expect(p[k]).toBeLessThanOrEqual(max[k] + 1e-6);
    }
  });
});

describe('Dot — dots, life and colour', () => {
  it('Stagger spawns one per Interval up to the count', () => {
    const at = (ms: number) => play({ speed: 0, ...RANDOM, count: 3, spawn: 'stagger', interval: 100 }, ms).state.dots.length;
    expect([at(50), at(150), at(450)]).toEqual([1, 2, 3]);
  });

  it('a Stream keeps spawning, recycling the oldest past the count', () => {
    const { state } = play({ speed: 0, ...RANDOM, count: 2, spawn: 'stream', interval: 100 }, 1000);
    expect(state.dots).toHaveLength(2);
    expect(state.spawned).toBe(11);
  });

  it('Lifespan ends a dot; Max alive caps the dots in a hit', () => {
    expect(lit(play({ speed: 0, life: 200 }, 100).fb)).toHaveLength(1);
    expect(lit(play({ speed: 0, life: 200 }, 300).fb)).toHaveLength(0);
    expect(play({ speed: 0, ...RANDOM, count: 10, maxLive: 4 }, 0).state.dots).toHaveLength(4);
  });

  it('a Stream with Oldest = Fade fades the recycled dot out over Fade time', () => {
    const p = { speed: 0, ...RANDOM, count: 1, spawn: 'stream', interval: 1000, oldest: 'fade', oldestFade: 400 };
    // At 1000ms the second dot arrives; the first is fading, so both still show.
    expect(play(p, 1200).state.dots).toHaveLength(2);
    expect(play(p, 1500).state.dots).toHaveLength(1);
    expect(play({ ...p, oldest: 'cut' }, 1200).state.dots).toHaveLength(1);
  });

  const rgbOf = (fb: Framebuffer, i: number) => [0, 1, 2].map((c) => fb.rgba[i * 4 + c]!.toFixed(3)).join(',');

  it('colour is Hue and Saturation, like the other effects', () => {
    const { fb } = play({ speed: 0, hue: 0, saturation: 1 }, 0);
    expect(rgbOf(fb, brightest(fb))).toBe('1.000,0.000,0.000');
  });

  it('Per hit: each hit a different colour, every dot of one hit the same', () => {
    const colours = (seq: number) => {
      const { fb } = play({ speed: 0, ...RANDOM, count: 3, colorMode: 'per-hit' }, 0, { seq });
      return lit(fb).map((i) => rgbOf(fb, i));
    };
    const one = colours(1);
    expect(new Set(one).size).toBe(1);
    expect(colours(2)[0]).not.toBe(one[0]);
  });

  it('Per pixel: a 5-pixel dot shows 5 colours (Tim, 2026-10-05: "5 pixels … 5 different colours")', () => {
    const { fb } = play({ speed: 0, length: 5, form: 'bar', colorMode: 'per-pixel', hueSpread: 360 }, 0);
    const on = lit(fb);
    expect(on).toHaveLength(5);
    expect(new Set(on.map((i) => rgbOf(fb, i))).size).toBe(5);
  });

  it('Vel → dots: a soft hit plays fewer', () => {
    expect(play({ speed: 0, ...RANDOM, count: 8, velCount: 1 }, 0, { velocity: 0.5 }).state.dots).toHaveLength(4);
  });

  it('a Background lights the rest; None leaves it dark', () => {
    expect(lit(play({ speed: 0 }, 0).fb)).toHaveLength(1);
    const { fb } = play({ speed: 0, background: 'other', bgHue: 240, bgSat: 1, bgLevel: 0.2, hue: 0 }, 0);
    expect(lit(fb)).toHaveLength(M.pixelCount);
    const head = brightest(fb);
    expect(fb.rgba[head * 4]).toBeCloseTo(1);
    const other = head === 0 ? 1 : 0;
    expect(fb.rgba[other * 4 + 2]).toBeCloseTo(0.2);
  });

  it('Change → To hue turns each dot to the second hue over its life', () => {
    const { fb } = play({ speed: 0, life: 1000, fade: 0, hue: 0, shift: 'to-hue', hueTo: 240 }, 990);
    const head = brightest(fb);
    expect(fb.rgba[head * 4 + 2]!).toBeGreaterThan(fb.rgba[head * 4]!);
  });

  it('replays exactly from the same seed', () => {
    const params = { ...RANDOM, randSpace: 1, count: 6, through: 'space', direction: 'random', bounce: 'random', speed: 120, life: 0 };
    expect(Array.from(play(params, 2000).fb.rgba)).toEqual(Array.from(play(params, 2000).fb.rgba));
  });
});

describe('dotCap — Max alive across hits', () => {
  it('keeps as many earlier hits as fit beside the new one', () => {
    expect(dotCap({ maxLive: 6, count: 2 })).toEqual({ keep: 2 });
    expect(dotCap({ maxLive: 1, count: 4 })).toEqual({ keep: 0 });
    expect(dotCap({ maxLive: 0, count: 2 })).toBeUndefined();
  });

  it('Oldest = Fade hands the engine a fade time', () => {
    expect(dotCap({ maxLive: 2, count: 1, oldest: 'fade', oldestFade: 300 })).toEqual({ keep: 1, fadeMs: 300 });
  });
});

describe('Dot — card sections', () => {
  it('every param sits under a section, in card order', () => {
    expect(dot.paramSpec.every((p) => p.section)).toBe(true);
    const order = [...new Set(dot.paramSpec.map((p) => p.section))];
    // Move around + Move through became one Movement heading; Random has its own (Tim, 2026-10-05).
    expect(order).toEqual(['Dots', 'Random', 'Life', 'Shape', 'Movement', 'Colour', 'Background', 'Velocity']);
    expect(dot.paramSpec.find((p) => p.key === 'maxLive')?.label).toBe('Max alive');
  });
});

describe('dotSpanMs — when a hit\'s last dot ends', () => {
  it('Lifespan, plus the stagger before the last dot; never, for a Stream or Lifespan 0', () => {
    expect(dotSpanMs({ life: 2000 })).toBe(2000);
    expect(dotSpanMs({ life: 500, spawn: 'stagger', count: 4, interval: 250 })).toBe(1250);
    expect(dotSpanMs({ life: 500, spawn: 'stagger', count: 4, interval: 250, maxLive: 2 })).toBe(750);
    expect(dotSpanMs({ life: 2000, spawn: 'stream' })).toBeNull();
    expect(dotSpanMs({ life: 0 })).toBeNull();
  });
});
