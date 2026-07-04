import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { createEmitterState, updateEmissions, MAX_EMISSIONS } from './emitter';
import { chaseBands } from './impl/chase-bands';
import { ripple3d } from './impl/ripple-3d';
import { sparkArc } from './impl/spark-arc';
import { rain3d } from './impl/rain-3d';

function model(drums = 2, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: drumDefs,
    }),
  );
}

function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: opts.timeMs ?? 0,
    dt: opts.dt ?? 16,
    transport: opts.transport ?? transport(0, opts.timeMs ?? 0),
    triggers: opts.triggers ?? [],
  };
}

function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

function render<S>(
  effect: EffectGenerator<S>,
  m: PixelModel,
  c: RenderContext,
  params?: ResolvedParams,
  state?: S,
): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m) : (undefined as S));
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
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    expect(Number.isFinite(v), `${id} channel ${i}`).toBe(true);
    expect(v >= 0 && v <= 1, `${id} channel ${i} = ${v}`).toBe(true);
  }
}

describe('emitter', () => {
  it('spawns once per seq, ages by dt, expires at ttl', () => {
    const m = model(1);
    const st = createEmitterState();
    const c1 = ctx(m, { dt: 10, triggers: [trig(1, 'd0', 36, 1, 0)] });
    expect(updateEmissions(st, c1, 100, () => undefined).length).toBe(1);
    // Same trigger again: no re-spawn; existing emission ages by dt.
    expect(updateEmissions(st, c1, 100, () => undefined).length).toBe(1);
    expect(st.emissions[0]!.ageMs).toBe(10);
    // Age past ttl → expired.
    for (let i = 0; i < 12; i++) updateEmissions(st, ctx(m, { dt: 10 }), 100, () => undefined);
    expect(st.emissions.length).toBe(0);
  });

  it('layers concurrent hits and caps at MAX_EMISSIONS', () => {
    const m = model(1);
    const st = createEmitterState();
    const many: Trigger[] = [];
    for (let s = 1; s <= MAX_EMISSIONS + 10; s++) many.push(trig(s, 'd0', 36, 1, 0));
    const live = updateEmissions(st, ctx(m, { dt: 0, triggers: many }), 1000, () => undefined);
    expect(live.length).toBe(MAX_EMISSIONS);
  });

  it('seeds age from the trigger age at spawn', () => {
    const m = model(1);
    const st = createEmitterState();
    updateEmissions(st, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 250)] }), 1000, () => undefined);
    expect(st.emissions[0]!.ageMs).toBe(250);
  });
});

describe('batch-e: all four render finite [0,1]', () => {
  it('never emit NaN or out-of-range channel values', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 0.8, 30), trig(2, 'd1', 38, 1, 120)];
    for (const e of [chaseBands, ripple3d, sparkArc, rain3d] as EffectGenerator<unknown>[]) {
      const state = e.createState!(m);
      const fb = render(e, m, ctx(m, { timeMs: 250, transport: transport(2.3, 250), triggers }), {}, state);
      assertFinite01(fb, e.id);
    }
  });
});

describe('chase-bands', () => {
  it('two hits a beat apart produce two distinct bands, not one stacked band', () => {
    const m = model(1, 4);
    const state = chaseBands.createState!(m);
    // Hit 1 is 500ms old (one beat at 120bpm), hit 2 just landed. speed .25 rev/beat,
    // width .25 hoop → heads 90° apart, bands 90° wide: disjoint angular clusters.
    const triggers = [trig(1, 'd0', 36, 1, 500), trig(2, 'd0', 36, 1, 0)];
    const fb = render(chaseBands, m, ctx(m, { dt: 0, triggers }), { lifeBeats: 8 }, state);
    const lit = litIds(fb);
    expect(lit.length).toBeGreaterThan(0);
    // Collect lit pixel head-relative angles on hoop 0; two bands ⇒ angles spread > one band width.
    const angles = lit
      .map((id) => m.pixels[id]!)
      .filter((p) => p.hoopIndex === 0)
      .map((p) => p.angleDeg)
      .sort((a, b) => a - b);
    expect(angles.length).toBeGreaterThan(0);
    const spreadDeg = angles[angles.length - 1]! - angles[0]!;
    expect(spreadDeg).toBeGreaterThan(95); // one 90° band could never span this
  });

  it('band fades out after lifeBeats', () => {
    const m = model(1);
    const state = chaseBands.createState!(m);
    render(chaseBands, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), { lifeBeats: 1 }, state);
    // 1 beat at 120bpm = 500ms; age well past it.
    const fb = render(chaseBands, m, ctx(m, { dt: 600 }), { lifeBeats: 1 }, state);
    expect(litIds(fb).length).toBe(0);
  });

  it('is deterministic (same hits → identical frames)', () => {
    const m = model(1);
    const run = (): Framebuffer => {
      const state = chaseBands.createState!(m);
      render(chaseBands, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), {}, state);
      return render(chaseBands, m, ctx(m, { dt: 250 }), {}, state);
    };
    expect(run().rgba).toEqual(run().rgba);
  });
});

describe('ripple-3d', () => {
  it('the wavefront crosses onto the OTHER drum as it expands', () => {
    const m = model(2); // drums at x=0 and x=600
    const state = ripple3d.createState!(m);
    const params = { speed: 1000, thickness: 120, lifeMs: 3000 };
    // Young ripple: only near the struck drum.
    render(ripple3d, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, state);
    const early = render(ripple3d, m, ctx(m, { dt: 100 }), params, state);
    const d1 = m.drumById.get('d1')!;
    const onD1 = (fb: Framebuffer) =>
      litIds(fb).filter((id) => id >= d1.pixelStart && id < d1.pixelStart + d1.pixelCount).length;
    expect(onD1(early)).toBe(0);
    // At ~600ms the front (1000mm/s) reaches the far drum 600mm away.
    const late = render(ripple3d, m, ctx(m, { dt: 500 }), params, state);
    expect(onD1(late)).toBeGreaterThan(0);
  });

  it('two concurrent hits render two wavefronts', () => {
    const m = model(2);
    const state = ripple3d.createState!(m);
    const triggers = [trig(1, 'd0', 36, 1, 200), trig(2, 'd1', 38, 1, 200)];
    const fb = render(ripple3d, m, ctx(m, { dt: 0, triggers }), { speed: 500 }, state);
    const d0 = m.drumById.get('d0')!;
    const d1 = m.drumById.get('d1')!;
    const lit = litIds(fb);
    expect(lit.some((id) => id < d0.pixelStart + d0.pixelCount)).toBe(true);
    expect(lit.some((id) => id >= d1.pixelStart)).toBe(true);
  });
});

describe('spark-arc', () => {
  it('lands a flash on the target drum after travel completes', () => {
    const m = model(2);
    const state = sparkArc.createState!(m, 7);
    const params = { travelBeats: 1 }; // 500ms at 120bpm
    render(sparkArc, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, state);
    // Just after landing: flash on the (only possible) target drum d1.
    const fb = render(sparkArc, m, ctx(m, { dt: 520 }), params, state);
    const d1 = m.drumById.get('d1')!;
    const onTarget = litIds(fb).filter((id) => id >= d1.pixelStart && id < d1.pixelStart + d1.pixelCount);
    expect(onTarget.length).toBeGreaterThan(0);
  });

  it('is seed-deterministic across replays', () => {
    const m = model(2);
    const run = (): Framebuffer => {
      const state = sparkArc.createState!(m, 42);
      render(sparkArc, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), {}, state);
      return render(sparkArc, m, ctx(m, { dt: 250 }), {}, state);
    };
    expect(run().rgba).toEqual(run().rgba);
  });

  it('renders nothing after the flash decays (ttl expiry)', () => {
    const m = model(2);
    const state = sparkArc.createState!(m, 7);
    render(sparkArc, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), { travelBeats: 0.25 }, state);
    const fb = render(sparkArc, m, ctx(m, { dt: 5000 }), { travelBeats: 0.25 }, state);
    expect(litIds(fb).length).toBe(0);
  });
});

describe('rain-3d', () => {
  it('ambient drops light pixels and keep raining across frames', () => {
    const m = model(2);
    const state = rain3d.createState!(m, 3);
    let anyLit = 0;
    for (let f = 0; f < 120; f++) {
      const fb = render(rain3d, m, ctx(m, { timeMs: f * 16, dt: 16 }), { density: 64 }, state);
      assertFinite01(fb, 'rain-3d');
      anyLit += litIds(fb).length;
    }
    expect(anyLit).toBeGreaterThan(0);
    expect(state.drops.length).toBeGreaterThan(0);
  });

  it('a hit bursts extra drops above the struck drum', () => {
    const m = model(2);
    const state = rain3d.createState!(m, 3);
    render(rain3d, m, ctx(m, { dt: 16 }), { density: 0, hitBurst: 16 }, state);
    expect(state.drops.length).toBe(0);
    render(rain3d, m, ctx(m, { dt: 16, triggers: [trig(1, 'd0', 36, 1, 0)] }), { density: 0, hitBurst: 16 }, state);
    expect(state.drops.length).toBe(16);
    // Burst drops are one-shot: they die at the floor instead of recycling.
    for (let f = 0; f < 600; f++) render(rain3d, m, ctx(m, { dt: 16 }), { density: 0, hitBurst: 16 }, state);
    expect(state.drops.length).toBe(0);
  });

  it('is seed-deterministic', () => {
    const m = model(2);
    const run = (): Framebuffer => {
      const state = rain3d.createState!(m, 11);
      let fb!: Framebuffer;
      for (let f = 0; f < 30; f++) fb = render(rain3d, m, ctx(m, { timeMs: f * 16, dt: 16 }), {}, state);
      return fb;
    };
    expect(run().rgba).toEqual(run().rgba);
  });
});
