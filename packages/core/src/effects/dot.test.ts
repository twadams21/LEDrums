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
import { dot, dotCap, dotSpanMs } from './impl/dot';

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

const FIXED = { start: 'fixed', startHoop: 1, startAngle: 0 };

describe('Dot — registry', () => {
  it('is a registered effect and a Generator kind', () => {
    expect(tryGetEffect('dot')?.description).toBeTruthy();
    expect(resolveGenerator({ kind: 'dot', style: '', params: {} })?.effectId).toBe('dot');
  });
});

describe('Dot — placement and shape', () => {
  it('a single one-pixel dot starts on the struck drum', () => {
    const { fb } = play({ speed: 0 }, 0, { drum: 'b' });
    const on = lit(fb);
    expect(on).toHaveLength(1);
    expect(M.pixels[on[0]!]!.drumId).toBe('b');
  });

  it('Length sets how many pixels it covers; Height spreads it over neighbouring hoops', () => {
    const { fb } = play({ ...FIXED, speed: 0, length: 5, form: 'bar', height: 3, startHoop: 2 }, 0);
    const on = lit(fb);
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

describe('Dot — moving around', () => {
  it('travels round its hoop at Speed pixels a second, either way', () => {
    const fwd = play({ ...FIXED, speed: 40 }, 500).fb;
    expect(M.pixels[brightest(fwd)]!.indexInHoop - 1).toBe(20);
    const rev = play({ ...FIXED, speed: 40, direction: 'reverse' }, 500).fb;
    expect(M.pixels[brightest(rev)]!.indexInHoop - 1).toBe(20);
    // 20 px either way round a 40-px ring lands opposite the start; a quarter tells them apart.
    const q = play({ ...FIXED, speed: 40, direction: 'reverse' }, 250).fb;
    expect(M.pixels[brightest(q)]!.indexInHoop - 1).toBe(30);
  });

  it('Speed per beat follows the tempo (120 bpm = 2 beats a second)', () => {
    const { fb } = play({ ...FIXED, speed: 5, speedPer: 'beat' }, 1000);
    expect(M.pixels[brightest(fb)]!.indexInHoop - 1).toBe(10);
  });

  it('a Trail lights pixels behind it, not ahead', () => {
    const { fb } = play({ ...FIXED, speed: 40, trail: 4 }, 250);
    const idx = lit(fb).map((i) => M.pixels[i]!.indexInHoop - 1);
    expect(Math.max(...idx)).toBe(10);
    expect(Math.min(...idx)).toBeGreaterThanOrEqual(6);
  });

  it('Ping-pong turns back after Span pixels', () => {
    const at = (ms: number) => M.pixels[brightest(play({ ...FIXED, speed: 40, bounce: 'pingpong', span: 10 }, ms).fb)]!.indexInHoop - 1;
    expect(at(250)).toBe(10);
    expect(at(500)).toBe(0);
  });

  it('Bounce: two dots meeting head-on turn back', () => {
    const { state } = play({ ...FIXED, start: 'even', count: 2, direction: 'alternate', bounce: 'bounce', speed: 40 }, 400);
    expect(state.dots.map((d) => d.dir)).toEqual([-1, 1]);
  });

  it('Speed 0 holds still: dots stay where they appeared', () => {
    const a = lit(play({ start: 'random', count: 5, speed: 0 }, 0).fb);
    const b = lit(play({ start: 'random', count: 5, speed: 0 }, 1000).fb);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe('Dot — moving through', () => {
  // Tim, 2026-10-05: "i can't get any vertical motion happening" — a dot used to step up a hoop
  // only after a full lap, so it never climbed within a hit. Now it travels at the Climb angle.
  const GAP = dot.createState!(M, 1).gapPx[0]!;

  it('Through a drum at Climb 90°: straight up, a hoop every gap of pixels, no travel round', () => {
    const d = play({ ...FIXED, speed: GAP * 2, through: 'drum' }, 500).state.dots[0]!;
    expect(d.hf).toBeCloseTo(1, 1);
    expect(d.u).toBeCloseTo(0, 5);
  });

  it('at the top hoop Bounce turns back down; Wrap comes back in at the bottom', () => {
    const at = (ms: number, bounce: string) => play({ ...FIXED, speed: GAP * 2, through: 'drum', bounce }, ms).state.dots[0]!;
    expect(at(1250, 'bounce').hf).toBeCloseTo(1.5, 1);
    expect(at(1250, 'bounce').step).toBe(-1);
    expect(at(1400, 'wrap').hoop).toBe(0);
  });

  it('Climb 45° spirals: up the drum and round it together; Reverse heads down', () => {
    const d = play({ ...FIXED, speed: GAP * 2, through: 'drum', climb: 45 }, 500).state.dots[0]!;
    expect(d.hf).toBeGreaterThan(0.5);
    expect(d.u).toBeGreaterThan(0);
    const down = play({ ...FIXED, speed: GAP * 2, through: 'drum', direction: 'reverse', startHoop: 3 }, 500).state.dots[0]!;
    expect(down.hf).toBeCloseTo(1, 1);
  });

  it('a climbing one-pixel dot glides between hoops, shared across the two', () => {
    const { fb } = play({ ...FIXED, speed: GAP * 2, through: 'drum' }, 250);
    expect(new Set(lit(fb).map((i) => M.pixels[i]!.hoopIndex))).toEqual(new Set([1, 2]));
  });

  it('Climb 0° keeps a dot on its hoop, like Through a hoop', () => {
    expect(play({ ...FIXED, speed: 40, through: 'drum', climb: 0 }, 2000).state.dots[0]!.hoop).toBe(0);
  });

  it('Through the kit: each lap hops to the next drum — or after Hop after pixels', () => {
    const { state } = play({ ...FIXED, speed: 40, through: 'kit' }, 1050, { drum: 'a' });
    expect(M.drums[state.dots[0]!.drum]!.drumId).toBe('b');
    const soon = play({ ...FIXED, speed: 40, through: 'kit', hopEvery: 8 }, 250, { drum: 'a' }).state;
    expect(M.drums[soon.dots[0]!.drum]!.drumId).toBe('b');
  });

  it('Through space: flies off its drum and stays inside the kit, bouncing off its edges', () => {
    const { state } = play({ ...FIXED, speed: 200, through: 'space', bounce: 'bounce', direction: 'random' }, 5000);
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
    const at = (ms: number) => play({ speed: 0, start: 'random', count: 3, spawn: 'stagger', interval: 100 }, ms).state.dots.length;
    expect([at(50), at(150), at(450)]).toEqual([1, 2, 3]);
  });

  it('a Stream keeps spawning, recycling the oldest past the count', () => {
    const { state } = play({ speed: 0, start: 'random', count: 2, spawn: 'stream', interval: 100 }, 1000);
    expect(state.dots).toHaveLength(2);
    expect(state.spawned).toBe(11);
  });

  it('Lifespan ends a dot; Max alive caps the dots in a hit', () => {
    expect(lit(play({ speed: 0, life: 200 }, 100).fb)).toHaveLength(1);
    expect(lit(play({ speed: 0, life: 200 }, 300).fb)).toHaveLength(0);
    expect(play({ speed: 0, start: 'random', count: 10, maxLive: 4 }, 0).state.dots).toHaveLength(4);
  });

  it('a Stream with Oldest = Fade fades the recycled dot out over Fade time', () => {
    const p = { speed: 0, start: 'random', count: 1, spawn: 'stream', interval: 1000, oldest: 'fade', oldestFade: 400 };
    // At 1000ms the second dot arrives; the first is fading, so both still show.
    expect(play(p, 1200).state.dots).toHaveLength(2);
    expect(play(p, 1500).state.dots).toHaveLength(1);
    expect(play({ ...p, oldest: 'cut' }, 1200).state.dots).toHaveLength(1);
  });

  it('Per hit: each hit a different colour, every dot of one hit the same', () => {
    const p = { speed: 0, start: 'random', count: 3, colorMode: 'per-hit', color: '#ff0000' };
    const colours = (seq: number) => {
      const { fb } = play(p, 0, { seq });
      return lit(fb).map((i) => [0, 1, 2].map((c) => fb.rgba[i * 4 + c]!.toFixed(3)).join(','));
    };
    const one = colours(1);
    expect(new Set(one).size).toBe(1);
    expect(colours(2)[0]).not.toBe(one[0]);
  });

  it('Vel → dots: a soft hit plays fewer', () => {
    expect(play({ speed: 0, start: 'random', count: 8, velCount: 1 }, 0, { velocity: 0.5 }).state.dots).toHaveLength(4);
  });

  it('a Background lights the rest; None leaves it dark', () => {
    expect(lit(play({ speed: 0 }, 0).fb)).toHaveLength(1);
    const { fb } = play({ speed: 0, background: 'other', bgColor: '#0000ff', bgLevel: 0.2, color: '#ff0000' }, 0);
    expect(lit(fb)).toHaveLength(M.pixelCount);
    const head = brightest(fb);
    expect(fb.rgba[head * 4]).toBeCloseTo(1);
    const other = head === 0 ? 1 : 0;
    expect(fb.rgba[other * 4 + 2]).toBeCloseTo(0.2);
  });

  it('Change → to colour fades each dot to the second colour over its life', () => {
    const { fb } = play({ speed: 0, life: 1000, fade: 0, color: '#ff0000', shift: 'to-colour', colorTo: '#0000ff' }, 990);
    const head = brightest(fb);
    expect(fb.rgba[head * 4 + 2]!).toBeGreaterThan(fb.rgba[head * 4]!);
  });

  it('replays exactly from the same seed', () => {
    const params = { start: 'random', count: 6, through: 'space', direction: 'random', bounce: 'random', speed: 120, life: 0 };
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
    expect(order).toEqual(['Dots', 'Life', 'Shape', 'Move around', 'Move through', 'Colour', 'Background', 'Velocity']);
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
