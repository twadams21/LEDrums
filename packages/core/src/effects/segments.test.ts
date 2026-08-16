import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { buildSegmentOrder, MAX_SEGMENTS, paletteHue, segmentAt, segments, type SegmentsState } from './impl/segments';

// --- harness (matches the house shape in u6-gap-fill.test.ts) -----------------

function model(drums = 2, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({ id: `d${i}`, diameterIn: 8, hoopSpacingMm: 50, origin: { x: i * 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
  }
  return buildPixelModel(parseKit({ global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 }, drums: drumDefs }));
}

/** The real rig: kick 196 / snare 108 / tom1 108 / tom2 136 pixels per hoop. */
function kitModel(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'kick', diameterIn: 22, hoopSpacingMm: 50, pixelsPerHoop: 196, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 14, hoopSpacingMm: 50, pixelsPerHoop: 108, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'tom1', diameterIn: 12, hoopSpacingMm: 50, pixelsPerHoop: 108, origin: { x: 1200, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'tom2', diameterIn: 16, hoopSpacingMm: 50, pixelsPerHoop: 136, origin: { x: 1800, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return { model: m, timeMs: opts.timeMs ?? 0, dt: opts.dt ?? 16, transport: opts.transport ?? transport(0, opts.timeMs ?? 0), triggers: opts.triggers ?? [] };
}

function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

function render<S>(effect: EffectGenerator<S>, m: PixelModel, c: RenderContext, params?: ResolvedParams, state?: S): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m, 123) : (undefined as S));
  effect.render(c, p, fb, s);
  return fb;
}

function litIds(fb: Framebuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) out.push(i);
  }
  return out;
}

function assertFinite01(fb: Framebuffer, id: string): void {
  let bad = -1;
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      bad = i;
      break;
    }
  }
  expect(bad === -1 ? 'ok' : `${id} channel ${bad} = ${fb.rgba[bad]}`).toBe('ok');
}

/** Hard-edged params: gap/feather off, so wedge membership is exact and testable. */
const HARD: ResolvedParams = { gap: 0, feather: 0 };

function state(seed = 123): SegmentsState {
  return segments.createState!(model(), seed);
}

/** The set of wedge indices any lit pixel of `drumId` falls in. */
function litWedges(fb: Framebuffer, m: PixelModel, drumId: string, n: number, rotationDeg = 0): Set<number> {
  const out = new Set<number>();
  for (const id of litIds(fb)) {
    const p = m.pixels[id]!;
    if (p.drumId !== drumId) continue;
    out.add(segmentAt(p.angleDeg, rotationDeg, n).index);
  }
  return out;
}

/** One hit on d0 at full velocity, landing this frame. */
const hit = [trig(1, 'd0', 36, 1, 0)];

/**
 * Step the emission forward by `frames` × 125ms and return the last frame. Emission age
 * advances by `ctx.dt`, so time only moves when frames are rendered — at 120bpm/4 seg-per-beat
 * one frame is exactly one wedge of travel.
 */
function advance<S>(m: PixelModel, s: S, params: ResolvedParams, frames: number): Framebuffer {
  let fb = new Framebuffer(m.pixelCount);
  for (let i = 0; i < frames; i++) fb = render(segments, m, ctx(m, { dt: 125 }), params, s as SegmentsState);
  return fb;
}

// --- geometry ----------------------------------------------------------------

describe('segmentAt', () => {
  it('places an angle in the wedge its sector owns, with the leading edge inclusive', () => {
    // 8 wedges = 45° each. 0° opens wedge 0; 45° opens wedge 1 (boundaries belong forward).
    expect(segmentAt(0, 0, 8)).toEqual({ index: 0, frac: 0 });
    expect(segmentAt(44.999, 0, 8).index).toBe(0);
    expect(segmentAt(45, 0, 8)).toEqual({ index: 1, frac: 0 });
    expect(segmentAt(359.999, 0, 8).index).toBe(7);
  });

  it('reports the fraction travelled through the wedge', () => {
    expect(segmentAt(22.5, 0, 8).frac).toBeCloseTo(0.5, 10);
    expect(segmentAt(67.5, 0, 8)).toMatchObject({ index: 1 });
    expect(segmentAt(67.5, 0, 8).frac).toBeCloseTo(0.5, 10);
  });

  it('rotates the whole wedge ring by rotationDeg, wrapping negatives', () => {
    expect(segmentAt(45, 45, 8)).toEqual({ index: 0, frac: 0 });
    expect(segmentAt(0, 45, 8).index).toBe(7); // -45° wraps to the last wedge
  });

  it('clamps the wedge count into the supported range', () => {
    expect(segmentAt(180, 0, 1).index).toBe(1); // <2 clamps to 2 → 180° is wedge 1
    expect(segmentAt(359, 0, 999).index).toBe(MAX_SEGMENTS - 1);
  });
});

// --- firing order ------------------------------------------------------------

describe('buildSegmentOrder', () => {
  const run = (n: number, offset: number, stride: number, dir: number, seed: number | null): number[] => {
    const order = new Int32Array(MAX_SEGMENTS);
    const ordOf = new Int32Array(MAX_SEGMENTS);
    buildSegmentOrder(n, offset, stride, dir, seed, order, ordOf);
    for (let k = 0; k < n; k++) expect(ordOf[order[k]!]).toBe(k); // the two views agree
    return Array.from(order.slice(0, n));
  };

  it('walks every wedge exactly once for any wedge-count / stride pair', () => {
    for (let n = 2; n <= MAX_SEGMENTS; n++) {
      for (let stride = 1; stride <= 8; stride++) {
        const got = run(n, 0, stride, 1, null);
        expect(new Set(got).size, `n=${n} stride=${stride}`).toBe(n);
        expect(Math.min(...got)).toBe(0);
        expect(Math.max(...got)).toBe(n - 1);
      }
    }
  });

  it('starts at the offset and steps by stride in the chosen direction', () => {
    expect(run(8, 0, 1, 1, null)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(run(8, 3, 1, 1, null)).toEqual([3, 4, 5, 6, 7, 0, 1, 2]);
    expect(run(8, 0, 1, -1, null)).toEqual([0, 7, 6, 5, 4, 3, 2, 1]);
    expect(run(8, 0, 3, 1, null)).toEqual([0, 3, 6, 1, 4, 7, 2, 5]);
  });

  it('fills in the wedges a non-coprime stride would otherwise skip', () => {
    // stride 2 over 8 wedges hits the evens, then must pick up the odds rather than repeat.
    expect(run(8, 0, 2, 1, null)).toEqual([0, 2, 4, 6, 1, 3, 5, 7]);
  });

  it('shuffles into a different but still-total order under a seed', () => {
    const plain = run(16, 0, 1, 1, null);
    const shuffled = run(16, 0, 1, 1, 0xbeef);
    expect(new Set(shuffled).size).toBe(16);
    expect(shuffled).not.toEqual(plain);
    expect(run(16, 0, 1, 1, 0xbeef)).toEqual(shuffled); // same seed → same order
  });
});

// --- colour generators -------------------------------------------------------

describe('segments palettes', () => {
  const hues = (palette: string, n = 8, hue = 200, spread = 140, seed = 7): number[] =>
    Array.from({ length: n }, (_, i) => paletteHue(palette, i, n, hue, spread, seed));

  it('alternates between two hues', () => {
    expect(hues('alternate')).toEqual([200, 340, 200, 340, 200, 340, 200, 340]);
  });

  it('cycles three hues', () => {
    expect(hues('cycle3').slice(0, 4)).toEqual([200, 340, 480, 200]);
  });

  it('sweeps the spread evenly around the ring', () => {
    const got = hues('sweep');
    expect(got[0]).toBe(200);
    expect(got[4]).toBeCloseTo(270, 10); // half way round = half the spread
    expect(new Set(got).size).toBe(8);
  });

  it('steps the hue once per wedge', () => {
    expect(hues('hue-step').slice(0, 3)).toEqual([200, 340, 480]);
  });

  it('scatters hues within ±half the spread, stably per wedge', () => {
    const got = hues('random');
    expect(new Set(got).size).toBe(8);
    for (const h of got) expect(Math.abs(h - 200)).toBeLessThanOrEqual(70);
    expect(hues('random')).toEqual(got); // index-hashed, not stream-ordered
    expect(hues('random', 8, 200, 140, 9)).not.toEqual(got); // a different voice seed re-scatters
  });

  it('falls back to alternate for an unknown palette rather than throwing', () => {
    expect(hues('nonsense')).toEqual(hues('alternate'));
  });
});

// --- firing behaviours -------------------------------------------------------

describe('segments firing behaviours', () => {
  const m = model();

  it('lights every wedge at once under "all"', () => {
    const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'all', segments: 8 }, state());
    expect(litWedges(fb, m, 'd0', 8).size).toBe(8);
  });

  it('lights only the offset wedge under "single" — the one-node-per-wedge building block', () => {
    for (const offset of [0, 3, 7]) {
      const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'single', segments: 8, segmentOffset: offset }, state());
      expect([...litWedges(fb, m, 'd0', 8)], `offset ${offset}`).toEqual([offset]);
    }
  });

  it('widens "single" to a run of consecutive wedges', () => {
    const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'single', segments: 8, segmentOffset: 6, width: 3 }, state());
    expect([...litWedges(fb, m, 'd0', 8)].sort((a, b) => a - b)).toEqual([0, 6, 7]); // wraps past the top
  });

  it('lights every second wedge under "every-nth"', () => {
    const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'every-nth', segments: 8, stride: 2 }, state());
    expect([...litWedges(fb, m, 'd0', 8)].sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
  });

  it('advances the chase head one wedge per 1/speed beat, in order, within one hit', () => {
    const s = state();
    const params = { ...HARD, fire: 'chase', segments: 8, speed: 4, tail: 0, lifeBeats: 4 };
    // 120bpm ⇒ 500ms/beat; speed 4 seg/beat ⇒ one wedge every 125ms.
    const seen: number[] = [];
    let fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    seen.push([...litWedges(fb, m, 'd0', 8)][0]!);
    for (let step = 1; step < 8; step++) {
      fb = render(segments, m, ctx(m, { dt: 125, timeMs: step * 125, transport: transport(step * 0.25, step * 125) }), params, s);
      const lit = [...litWedges(fb, m, 'd0', 8)];
      expect(lit.length, `step ${step}`).toBe(1);
      seen.push(lit[0]!);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reverses the chase order under direction "ccw"', () => {
    const s = state();
    const params = { ...HARD, fire: 'chase', segments: 8, speed: 4, tail: 0, lifeBeats: 4, direction: 'ccw' };
    render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    const fb = render(segments, m, ctx(m, { dt: 125, timeMs: 125, transport: transport(0.25, 125) }), params, s);
    expect([...litWedges(fb, m, 'd0', 8)]).toEqual([7]);
  });

  it('trails the chase head over "tail" wedges', () => {
    const s = state();
    const params = { ...HARD, fire: 'chase', segments: 16, speed: 4, tail: 3, lifeBeats: 8 };
    render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    const fb = render(segments, m, ctx(m, { dt: 1000, timeMs: 1000, transport: transport(2, 1000) }), params, s);
    // head has travelled 8 wedges; the 3 behind it are still fading.
    expect([...litWedges(fb, m, 'd0', 16)].sort((a, b) => a - b)).toEqual([6, 7, 8]);
  });

  it('bounces back off the last wedge under "ping-pong" instead of wrapping', () => {
    const s = state();
    const params = { ...HARD, fire: 'ping-pong', segments: 8, speed: 4, tail: 0.5, lifeBeats: 8 };
    render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s); // the hit lands, age 0
    // The head spans n-1 = 7 wedges out and back; at 4 seg/beat that is one wedge per 125ms.
    expect([...litWedges(advance(m, s, params, 7), m, 'd0', 8)]).toEqual([7]); // reached the far end
    expect([...litWedges(advance(m, s, params, 2), m, 'd0', 8)]).toEqual([5]); // coming back, not wrapped to 1
  });

  it('visits wedges in a seeded random order under "random", covering all of them', () => {
    const s = state(2024);
    const params = { ...HARD, fire: 'random', segments: 8, speed: 4, tail: 0, lifeBeats: 8 };
    const seen: number[] = [];
    const first = render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    seen.push(...litWedges(first, m, 'd0', 8));
    for (let step = 1; step < 8; step++) seen.push(...litWedges(advance(m, s, params, 1), m, 'd0', 8));
    expect(seen.length).toBe(8); // exactly one wedge per step
    expect(new Set(seen).size).toBe(8); // every wedge visited exactly once
    expect(seen).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // …but not in ring order
  });
});

// --- expression shaping ------------------------------------------------------

describe('segments shaping', () => {
  const m = model();

  it('carves a dark lane between wedges as the gap opens', () => {
    const solid = litIds(render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'all', segments: 8 }, state())).length;
    const gapped = litIds(render(segments, m, ctx(m, { dt: 0, triggers: hit }), { fire: 'all', segments: 8, gap: 0.4, feather: 0 }, state())).length;
    expect(gapped).toBeGreaterThan(0);
    expect(gapped).toBeLessThan(solid);
  });

  it('feathers wedge edges down toward the boundary while holding the centre lit', () => {
    const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { fire: 'all', segments: 4, gap: 0, feather: 1 }, state());
    const d0 = m.drums[0]!;
    let centre = 0;
    let edge = 0;
    for (let i = d0.pixelStart; i < d0.pixelStart + d0.pixelCount; i++) {
      const { frac } = segmentAt(m.pixels[i]!.angleDeg, 0, 4);
      const a = fb.rgba[i * 4 + 3]!;
      if (frac > 0.35 && frac < 0.65) centre = Math.max(centre, a);
      if (frac < 0.1 || frac > 0.9) edge = Math.max(edge, a);
    }
    expect(centre).toBeGreaterThan(0.5); // the wedge core stays fully lit
    expect(edge).toBeLessThan(centre * 0.5); // boundaries ramp away
  });

  it('dims later wedges under a positive falloff and earlier ones under a negative', () => {
    const peak = (params: ResolvedParams, wedge: number): number => {
      const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, state());
      const d0 = m.drums[0]!;
      let out = 0;
      for (let i = d0.pixelStart; i < d0.pixelStart + d0.pixelCount; i++) {
        if (segmentAt(m.pixels[i]!.angleDeg, 0, 8).index === wedge) out = Math.max(out, fb.rgba[i * 4 + 3]!);
      }
      return out;
    };
    const forward = { ...HARD, fire: 'all', segments: 8, falloff: 0.8 };
    const back = { ...HARD, fire: 'all', segments: 8, falloff: -0.8 };
    expect(peak(forward, 0)).toBeGreaterThan(peak(forward, 7));
    expect(peak(back, 7)).toBeGreaterThan(peak(back, 0));
  });

  it('rolls wedge onsets across the life under stagger', () => {
    const s = state();
    const params = { ...HARD, fire: 'all', segments: 8, stagger: 1, lifeBeats: 4 };
    const first = render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    expect(litWedges(first, m, 'd0', 8).size).toBe(1); // only the first wedge has bloomed
    const later = render(segments, m, ctx(m, { dt: 1000, timeMs: 1000, transport: transport(2, 1000) }), params, s);
    expect(litWedges(later, m, 'd0', 8).size).toBeGreaterThan(3);
  });

  it('tilts intensity across the hoop stack under radial tilt', () => {
    const sideMax = (radial: number, shellSide: boolean): number => {
      const fb = render(segments, m, ctx(m, { dt: 0, triggers: hit }), { ...HARD, fire: 'all', segments: 8, radial }, state());
      const d0 = m.drums[0]!;
      let out = 0;
      for (let i = d0.pixelStart; i < d0.pixelStart + d0.pixelCount; i++) {
        const p = m.pixels[i]!;
        if (shellSide ? p.normHoop > 0.9 : p.normHoop < 0.1) out = Math.max(out, fb.rgba[i * 4 + 3]!);
      }
      return out;
    };
    expect(sideMax(0.9, false)).toBeGreaterThan(sideMax(0.9, true));
    expect(sideMax(-0.9, true)).toBeGreaterThan(sideMax(-0.9, false));
  });

  it('fades the whole emission out across its life', () => {
    const s = state();
    const params = { ...HARD, fire: 'all', segments: 8, lifeBeats: 2 };
    const early = render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    const late = render(segments, m, ctx(m, { dt: 750, timeMs: 750, transport: transport(1.5, 750) }), params, s);
    expect(Math.max(...late.rgba)).toBeLessThan(Math.max(...early.rgba));
    expect(litIds(late).length).toBeGreaterThan(0);
  });

  it('scales with hit velocity', () => {
    const soft = render(segments, model(), ctx(model(), { dt: 0, triggers: [trig(1, 'd0', 36, 0.25, 0)] }), { ...HARD, fire: 'all' }, state());
    const hard = render(segments, model(), ctx(model(), { dt: 0, triggers: hit }), { ...HARD, fire: 'all' }, state());
    expect(Math.max(...hard.rgba)).toBeGreaterThan(Math.max(...soft.rgba));
  });
});

// --- scoping, determinism, safety -------------------------------------------

describe('segments contract', () => {
  it('paints only the struck drum', () => {
    const m = model(3);
    const fb = render(segments, m, ctx(m, { dt: 0, triggers: [trig(1, 'd1', 38, 1, 0)] }), { ...HARD, fire: 'all' }, state());
    const drums = new Set(litIds(fb).map((id) => m.pixels[id]!.drumId));
    expect([...drums]).toEqual(['d1']);
  });

  it('layers one emission per new hit', () => {
    const m = model();
    const s = state();
    render(segments, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 0.8, 0)] }), { ...HARD }, s);
    expect(s.em.emissions.length).toBe(2);
  });

  it('renders nothing before a hit lands', () => {
    const m = model();
    expect(litIds(render(segments, m, ctx(m, { dt: 0 }), { ...HARD, fire: 'all' }, state()))).toEqual([]);
  });

  it('is deterministic across identical seeded replays', () => {
    const m = model();
    const run = (): Float32Array => {
      const s = segments.createState!(m, 42);
      const params = { fire: 'random', segments: 12, palette: 'random' };
      render(segments, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 0.7, 80)] }), params, s);
      return render(segments, m, ctx(m, { dt: 240, timeMs: 240, transport: transport(0.5, 240) }), params, s).rgba;
    };
    expect(run()).toEqual(run());
  });

  it('renders finite in-range frames on the real kit for every fire mode and palette', () => {
    const m = kitModel();
    for (const fire of ['chase', 'all', 'every-nth', 'ping-pong', 'random', 'single']) {
      for (const palette of ['alternate', 'cycle3', 'sweep', 'hue-step', 'random']) {
        const s = segments.createState!(m, 99);
        const params = { fire, palette, segments: 20 };
        render(segments, m, ctx(m, { dt: 0, triggers: [trig(1, 'kick', 36, 1, 0)] }), params, s);
        const fb = render(segments, m, ctx(m, { dt: 300, timeMs: 300, transport: transport(0.6, 300) }), params, s);
        assertFinite01(fb, `segments ${fire}/${palette}`);
        expect(litIds(fb).length, `${fire}/${palette}`).toBeGreaterThan(0);
      }
    }
  });

  it('survives degenerate params without throwing or emitting NaN', () => {
    const m = model();
    const s = state();
    const params = { segments: 0, speed: 0, width: 99, tail: 0, stride: 0, lifeBeats: 0, gap: 1, feather: 0, segmentOffset: 999 };
    render(segments, m, ctx(m, { dt: 0, triggers: hit }), params, s);
    assertFinite01(render(segments, m, ctx(m, { dt: 16, timeMs: 16 }), params, s), 'segments degenerate');
  });
});
