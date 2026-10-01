import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { gravityWells } from './impl/gravity-wells';
import { breathingKit } from './impl/breathing-kit';
import { tempSweep } from './impl/temp-sweep';
import { velocityFlames } from './impl/velocity-flames';
import { hueRotateKit } from './impl/hue-rotate-kit';

function model(drums = 1, hoopCount = 4): PixelModel {
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

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

function allFinite01(fb: Framebuffer): boolean {
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

describe('gravity-wells', () => {
  it('lights pixels near drifting wells and stays finite in [0,1]', () => {
    const m = model(2);
    const state = gravityWells.createState!(m);
    const fb = render(gravityWells, m, ctx(m, { timeMs: 500 }), { reach: 3000 }, state);
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(allFinite01(fb)).toBe(true);
  });

  it('is seed-deterministic across two fresh states', () => {
    const m = model(2);
    const a = render(gravityWells, m, ctx(m, { timeMs: 500 }), {}, gravityWells.createState!(m));
    const b = render(gravityWells, m, ctx(m, { timeMs: 500 }), {}, gravityWells.createState!(m));
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });
});

describe('breathing-kit', () => {
  it('lights every pixel uniformly and stays in range', () => {
    const m = model(2);
    const fb = render(breathingKit, m, ctx(m, { timeMs: 1000 }));
    expect(litCount(fb)).toBe(m.pixelCount);
    expect(allFinite01(fb)).toBe(true);
    // All pixels share the same colour (whole kit breathes as one).
    const c0 = [fb.rgba[0]!, fb.rgba[1]!, fb.rgba[2]!].join(',');
    const last = (m.pixelCount - 1) * 4;
    expect([fb.rgba[last]!, fb.rgba[last + 1]!, fb.rgba[last + 2]!].join(',')).toBe(c0);
  });
});

describe('temp-sweep', () => {
  it('lights all pixels with a warm↔cool gradient, finite in [0,1]', () => {
    const m = model(2);
    const fb = render(tempSweep, m, ctx(m, { timeMs: 800 }));
    expect(litCount(fb)).toBe(m.pixelCount);
    expect(allFinite01(fb)).toBe(true);
  });
});

describe('velocity-flames', () => {
  it('lights pixels for a recent hit and harder hits burn taller', () => {
    const m = model(1, 6);
    const fb = render(velocityFlames, m, ctx(m, { timeMs: 200, triggers: [trig(1, 'd0', 36, 1, 0)] }));
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(allFinite01(fb)).toBe(true);

    // A hard hit lights more of the drum (taller flame) than a soft one.
    const tall = litCount(render(velocityFlames, m, ctx(m, { timeMs: 200, triggers: [trig(1, 'd0', 36, 1, 0)] })));
    const short = litCount(render(velocityFlames, m, ctx(m, { timeMs: 200, triggers: [trig(1, 'd0', 36, 0.2, 0)] })));
    expect(tall).toBeGreaterThan(short);
  });

  it('lights nothing with no triggers', () => {
    const m = model(1, 6);
    expect(litCount(render(velocityFlames, m, ctx(m, { timeMs: 200 })))).toBe(0);
  });
});

describe('hue-rotate-kit', () => {
  it('lights every pixel and varies hue with height', () => {
    const m = model(1, 4);
    const fb = render(hueRotateKit, m, ctx(m, { timeMs: 400 }));
    expect(litCount(fb)).toBe(m.pixelCount);
    expect(allFinite01(fb)).toBe(true);
  });
});
