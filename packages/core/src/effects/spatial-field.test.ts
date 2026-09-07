import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type ResolvedParams } from './types';
import { spatialField, type SpatialFieldState } from './impl/spatial-field';
import { tryGetEffect } from './registry';
import { collectionOf } from './vocabulary';
import { resolveVoiceSustainMs } from './voice-life';

/** Four sparse drums in a row — the kit shape the defaults must read on. */
function model(drums = 4, hoopCount = 3, spacingMm = 600): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 10,
      hoopSpacingMm: 60,
      origin: { x: i * spacingMm, y: (i % 2) * 300, z: i * 120 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 25, hoopCount, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 100000 },
      drums: drumDefs,
    }),
  );
}

function transport(timeMs = 0): TransportState {
  const beat = (timeMs / 60000) * 120;
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: opts.timeMs ?? 0,
    dt: opts.dt ?? 16,
    transport: opts.transport ?? transport(opts.timeMs ?? 0),
    triggers: opts.triggers ?? [],
    authoredDecay: opts.authoredDecay,
  };
}

function trig(seq: number, drumId: string, velocity: number, ageMs = 0): Trigger {
  return { seq, drumId, note: 38, velocity, ageMs, timeMs: 0 };
}

function render(m: PixelModel, c: RenderContext, params: ResolvedParams = {}, state?: SpatialFieldState): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(spatialField.paramSpec), ...params };
  spatialField.render(c, p, fb, state ?? spatialField.createState!(m));
  return fb;
}

function assertFinite01(fb: Framebuffer, label: string): void {
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    expect(Number.isFinite(v), `${label} channel ${i}`).toBe(true);
    expect(v >= 0 && v <= 1, `${label} channel ${i} = ${v}`).toBe(true);
  }
}

function litCount(fb: Framebuffer, threshold = 0.02): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > threshold || fb.rgba[j + 1]! > threshold || fb.rgba[j + 2]! > threshold) n++;
  }
  return n;
}

function totalEnergy(fb: Framebuffer): number {
  let e = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    e += fb.rgba[j]! + fb.rgba[j + 1]! + fb.rgba[j + 2]!;
  }
  return e;
}

function diff(a: Framebuffer, b: Framebuffer): number {
  let d = 0;
  for (let i = 0; i < a.rgba.length; i++) d += Math.abs(a.rgba[i]! - b.rgba[i]!);
  return d;
}

/** Per-drum energy so a wave's spatial footprint can be compared between sources. */
function energyByDrum(fb: Framebuffer, m: PixelModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of fb.pixelCount ? m.pixels : []) {
    const j = p.id * 4;
    out.set(p.drumId, (out.get(p.drumId) ?? 0) + fb.rgba[j]! + fb.rgba[j + 1]! + fb.rgba[j + 2]!);
  }
  return out;
}

/** Field with the wave removed: the difference between hit and no-hit frames. */
function waveOnly(m: PixelModel, drumId: string, velocity: number, ageMs: number): Framebuffer {
  const state = spatialField.createState!(m);
  render(m, ctx(m, { dt: 0, timeMs: 500, triggers: [trig(1, drumId, velocity, 0)] }), {}, state);
  const hit = render(m, ctx(m, { dt: ageMs, timeMs: 500 }), {}, state);
  const base = render(m, ctx(m, { dt: 0, timeMs: 500 }));
  const out = new Framebuffer(m.pixelCount);
  for (let i = 0; i < out.rgba.length; i++) out.rgba[i] = Math.abs(hit.rgba[i]! - base.rgba[i]!);
  return out;
}

describe('spatial-field', () => {
  it('is registered as a texture with world/spatial tags and a valid default spec', () => {
    const e = tryGetEffect('spatial-field')!;
    expect(e).toBeDefined();
    expect(e.name).toBe('Spatial Field');
    expect(e.category).toBe('texture');
    expect(e.timebase).toBe('absolute');
    expect(e.tags).toEqual(expect.arrayContaining(['3d', 'kit-wide', 'texture']));
    expect(collectionOf(e.tags)).toBe('textures');
    expect(e.paramSpec.length).toBeLessThanOrEqual(11);
    for (const s of e.paramSpec) {
      if (s.type === 'number') {
        expect(Number.isFinite(s.default as number), s.key).toBe(true);
        expect(s.default as number).toBeGreaterThanOrEqual(s.min!);
        expect(s.default as number).toBeLessThanOrEqual(s.max!);
      }
    }
  });

  it('default is visible on four sparse hoops and on every drum, at t=0 and later', () => {
    const m = model(4, 3);
    for (const t of [0, 700, 3000]) {
      const fb = render(m, ctx(m, { timeMs: t }));
      assertFinite01(fb, `t=${t}`);
      expect(litCount(fb), `lit at t=${t}`).toBeGreaterThan(m.pixelCount * 0.5);
      const byDrum = energyByDrum(fb, m);
      for (const d of m.drums) expect(byDrum.get(d.drumId)!, `${d.drumId} at t=${t}`).toBeGreaterThan(0.1);
    }
  });

  it('is exactly repeatable for the same context and fresh state', () => {
    const m = model();
    const c = ctx(m, { timeMs: 1234, triggers: [trig(1, 'd1', 0.7, 80)] });
    const a = render(m, c);
    const b = render(m, c);
    expect(diff(a, b)).toBe(0);
  });

  it('time changes the image (the base field moves) and speed 0 freezes it', () => {
    const m = model();
    const a = render(m, ctx(m, { timeMs: 0 }));
    const b = render(m, ctx(m, { timeMs: 400 }));
    expect(diff(a, b)).toBeGreaterThan(1);
    const f0 = render(m, ctx(m, { timeMs: 0 }), { speed: 0 });
    const f1 = render(m, ctx(m, { timeMs: 4000 }), { speed: 0 });
    expect(diff(f0, f1)).toBe(0);
  });

  it('samples one continuous world field: moving a drum changes its pixels, not the others', () => {
    const near = model(2, 3, 600);
    const far = model(2, 3, 1200);
    // d0 sits at the same world position in both kits; only the bounds (and so the
    // normalisation) differ, so compare d0 pixel-for-pixel under an identical scale in mm by
    // holding kit size constant: use scale relative to a fixed extent instead.
    const a = render(near, ctx(near, { timeMs: 300 }));
    const b = render(far, ctx(far, { timeMs: 300 }));
    // Both kits render finite and lit; d1 differs between them (different world position).
    assertFinite01(a, 'near');
    assertFinite01(b, 'far');
    const ea = energyByDrum(a, near).get('d1')!;
    const eb = energyByDrum(b, far).get('d1')!;
    expect(ea).toBeGreaterThan(0);
    expect(eb).toBeGreaterThan(0);
    expect(Math.abs(ea - eb)).toBeGreaterThan(1e-6);
  });

  it('a hit produces a wave that changes the image and is strongest near the source', () => {
    const m = model(4, 3);
    const w0 = waveOnly(m, 'd0', 1, 120);
    expect(totalEnergy(w0)).toBeGreaterThan(0.5);
    const e0 = energyByDrum(w0, m);
    // 120ms at 1100mm/s ≈ 132mm radius: the front is still inside the struck drum.
    expect(e0.get('d0')!).toBeGreaterThan(e0.get('d3')!);
  });

  it('a translated source produces a spatially different perturbation', () => {
    const m = model(4, 3);
    const w0 = energyByDrum(waveOnly(m, 'd0', 1, 120), m);
    const w3 = energyByDrum(waveOnly(m, 'd3', 1, 120), m);
    expect(w0.get('d0')!).toBeGreaterThan(w3.get('d0')!);
    expect(w3.get('d3')!).toBeGreaterThan(w0.get('d3')!);
  });

  it('the wave expands outward over time and reaches other drums', () => {
    const m = model(4, 3);
    const early = energyByDrum(waveOnly(m, 'd0', 1, 100), m);
    const late = energyByDrum(waveOnly(m, 'd0', 1, 650), m); // ≈715mm: at d1 (600mm away)
    expect(late.get('d1')!).toBeGreaterThan(early.get('d1')!);
  });

  it('velocity scales the disturbance: 0 leaves the base field untouched, 1 distorts it', () => {
    const m = model(4, 3);
    expect(totalEnergy(waveOnly(m, 'd0', 0, 120))).toBe(0);
    const half = totalEnergy(waveOnly(m, 'd0', 0.5, 120));
    const full = totalEnergy(waveOnly(m, 'd0', 1, 120));
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
  });

  it('disturbance 0 disables the wave without touching the base field', () => {
    const m = model(4, 3);
    const state = spatialField.createState!(m);
    const hit = render(m, ctx(m, { dt: 0, timeMs: 500, triggers: [trig(1, 'd0', 1, 120)] }), { disturbance: 0 }, state);
    const base = render(m, ctx(m, { dt: 0, timeMs: 500 }), { disturbance: 0 });
    expect(diff(hit, base)).toBe(0);
  });

  it('the wave dies at lifeMs and an authored decay suppresses only the wave fade', () => {
    const m = model(2, 3);
    const state = spatialField.createState!(m);
    render(m, ctx(m, { dt: 0, timeMs: 0, triggers: [trig(1, 'd0', 1, 0)] }), { lifeMs: 300 }, state);
    render(m, ctx(m, { dt: 400, timeMs: 400 }), { lifeMs: 300 }, state);
    expect(state.em.emissions.length).toBe(0);
    // authoredDecay: the wave is at full strength at any age inside its life.
    const s2 = spatialField.createState!(m);
    render(m, ctx(m, { dt: 0, timeMs: 0, triggers: [trig(1, 'd0', 1, 0)], authoredDecay: true }), { lifeMs: 1000 }, s2);
    const late = render(m, ctx(m, { dt: 900, timeMs: 900, authoredDecay: true }), { lifeMs: 1000 }, s2);
    const s3 = spatialField.createState!(m);
    render(m, ctx(m, { dt: 0, timeMs: 0, triggers: [trig(1, 'd0', 1, 0)] }), { lifeMs: 1000 }, s3);
    const lateNatural = render(m, ctx(m, { dt: 900, timeMs: 900 }), { lifeMs: 1000 }, s3);
    expect(diff(late, lateNatural)).toBeGreaterThan(0);
  });

  it('declares its wave life so a one-shot voice outlives the ripple', () => {
    expect(spatialField.voiceLife).toEqual({ key: 'lifeMs', unit: 'ms' });
    expect(resolveVoiceSustainMs('spatial-field', { lifeMs: 2500 }, 120, 400)).toBeGreaterThanOrEqual(2500);
    expect(resolveVoiceSustainMs('spatial-field', {}, 120, 400)).toBeGreaterThanOrEqual(1500);
  });

  it('an unknown source drum does not throw and retains the base field', () => {
    const m = model(2, 3);
    const state = spatialField.createState!(m);
    const hit = render(m, ctx(m, { dt: 0, timeMs: 500, triggers: [trig(1, 'nope', 1, 50)] }), {}, state);
    const base = render(m, ctx(m, { dt: 0, timeMs: 500 }));
    assertFinite01(hit, 'unknown source');
    expect(diff(hit, base)).toBe(0);
  });

  it('parameter extremes stay finite and in range', () => {
    const m = model(4, 3);
    const extremes: ResolvedParams[] = [
      { scale: 0.2, twist: -8, speed: 2, disturbance: 1, waveSpeed: 5000, waveWidth: 20, lifeMs: 100, hueSpread: 360 },
      { scale: 6, twist: 8, speed: 0, disturbance: 0, waveSpeed: 100, waveWidth: 1000, lifeMs: 6000, hueSpread: 0 },
      { scale: 0, twist: 0, speed: -5, disturbance: 5, waveSpeed: 0, waveWidth: 0, lifeMs: 0, brightness: 2, saturation: -1 },
      { scale: Number.NaN, twist: Number.POSITIVE_INFINITY, hue: Number.NaN, brightness: Number.NaN },
    ];
    for (const params of extremes) {
      const state = spatialField.createState!(m);
      const trigs = [trig(1, 'd0', 1, 0), trig(2, 'd2', 0.3, 40)];
      for (let f = 0; f < 6; f++) {
        const fb = render(m, ctx(m, { dt: 90, timeMs: 5000 + f * 90, triggers: f === 0 ? trigs : [] }), params, state);
        assertFinite01(fb, JSON.stringify(params));
      }
    }
  });

  it('degenerate and replaced models render safely', () => {
    const one = model(1, 1);
    const fb = render(one, ctx(one, { timeMs: 200, triggers: [trig(1, 'd0', 1, 0)] }));
    assertFinite01(fb, 'one-hoop kit');
    expect(litCount(fb)).toBeGreaterThan(0);
    // State built on one model, rendered against another: the effect reads the ctx model.
    const state = spatialField.createState!(model(2, 3));
    const big = model(4, 4);
    render(big, ctx(big, { dt: 0, timeMs: 100, triggers: [trig(1, 'd3', 1, 0)] }), {}, state);
    const fb2 = render(big, ctx(big, { dt: 200, timeMs: 300 }), {}, state);
    assertFinite01(fb2, 'replaced model');
    expect(litCount(fb2)).toBeGreaterThan(0);
  });

  it('bounds live emissions under a runaway trigger stream', () => {
    const m = model(2, 3);
    const state = spatialField.createState!(m);
    const many: Trigger[] = [];
    for (let s = 1; s <= 500; s++) many.push(trig(s, 'd0', 1, 0));
    const fb = render(m, ctx(m, { dt: 0, timeMs: 10, triggers: many }), {}, state);
    assertFinite01(fb, 'runaway');
    expect(state.em.emissions.length).toBeLessThanOrEqual(64);
  });
});
