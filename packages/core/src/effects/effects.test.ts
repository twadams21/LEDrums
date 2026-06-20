import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { listEffects } from './registry';
import { solidBase } from './impl/solid-base';
import { chase } from './impl/chase';
import { wholeDrum } from './impl/whole-drum';
import { wholeKit } from './impl/whole-kit';
import { followHoop } from './impl/follow-hoop';
import { radialWash, waveRadius } from './impl/radial-wash';
import { wipe3d } from './impl/wipe-3d';
import { meterEq } from './impl/meter-eq';
import { pixelAccum } from './impl/pixel-accum';
import { colourMelody } from './impl/colour-melody';
import { strobe } from './impl/strobe';

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

function render<S>(effect: EffectGenerator<S>, m: PixelModel, c: RenderContext, params?: ResolvedParams, state?: S): Framebuffer {
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

describe('solid-base', () => {
  it('brightness 1 lights every pixel; brightness 0 is all black', () => {
    const m = model();
    expect(litCount(render(solidBase, m, ctx(m), { brightness: 1 }))).toBe(m.pixelCount);
    expect(litCount(render(solidBase, m, ctx(m), { brightness: 0 }))).toBe(0);
  });
});

describe('chase', () => {
  it('advances the lit hoop on beat subdivisions and lights one hoop group', () => {
    const m = model(1, 4);
    const at = (beat: number) => render(chase, m, ctx(m, { transport: transport(beat) }), { subdivision: 4 });
    const hoopOf = (fb: Framebuffer) =>
      new Set(m.pixels.filter((p) => fb.rgba[p.id * 4]! > 0.004 || fb.rgba[p.id * 4 + 2]! > 0.004 || fb.rgba[p.id * 4 + 1]! > 0.004).map((p) => p.hoopIndex));
    expect(hoopOf(at(0))).toEqual(new Set([0]));
    expect(hoopOf(at(0.25))).toEqual(new Set([1]));
    expect(hoopOf(at(0.5))).toEqual(new Set([2]));
    // wraps after the last hoop
    expect(hoopOf(at(1.0))).toEqual(new Set([0]));
  });
});

describe('whole-drum vs whole-kit', () => {
  it('whole-drum lights only the struck drum', () => {
    const m = model(2);
    const fb = render(wholeDrum, m, ctx(m, { triggers: [trig(1, 'd1', 38, 1, 0)] }));
    const d0 = m.drumById.get('d0')!;
    const d1 = m.drumById.get('d1')!;
    expect(fb.rgba[d1.pixelStart * 4 + 0]! + fb.rgba[d1.pixelStart * 4 + 1]! + fb.rgba[d1.pixelStart * 4 + 2]!).toBeGreaterThan(0);
    expect(fb.rgba[d0.pixelStart * 4 + 0]! + fb.rgba[d0.pixelStart * 4 + 1]! + fb.rgba[d0.pixelStart * 4 + 2]!).toBe(0);
  });

  it('whole-kit lights every pixel on any hit', () => {
    const m = model(2);
    const fb = render(wholeKit, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 0)] }));
    expect(litCount(fb)).toBe(m.pixelCount);
  });
});

describe('follow-hoop', () => {
  it('lights hoop 0 immediately and hoop 1 only after the delay', () => {
    const m = model(1, 4);
    const params = { delayMs: 100, decayMs: 2000 };
    const now = render(followHoop, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 0)] }), params);
    const later = render(followHoop, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 100)] }), params);
    const hoopLit = (fb: Framebuffer, hoop: number) =>
      m.pixels.filter((p) => p.hoopIndex === hoop).some((p) => fb.rgba[p.id * 4 + 1]! > 0.004 || fb.rgba[p.id * 4]! > 0.004 || fb.rgba[p.id * 4 + 2]! > 0.004);
    expect(hoopLit(now, 0)).toBe(true);
    expect(hoopLit(now, 1)).toBe(false);
    expect(hoopLit(later, 1)).toBe(true);
  });
});

describe('radial-wash', () => {
  it('waveRadius grows for out, shrinks for in, and bounces', () => {
    expect(waveRadius('out', 0, 1, 1000)).toBe(0);
    expect(waveRadius('out', 100, 1, 1000)).toBeGreaterThan(waveRadius('out', 50, 1, 1000));
    expect(waveRadius('in', 100, 1, 1000)).toBeLessThan(waveRadius('in', 50, 1, 1000));
    // bounce: rises to reach then falls back
    expect(waveRadius('bounce', 500, 1, 1000)).toBeGreaterThan(waveRadius('bounce', 100, 1, 1000));
    expect(waveRadius('bounce', 1500, 1, 1000)).toBeLessThan(waveRadius('bounce', 1000, 1, 1000));
  });

  it('renders a band around the expanding radius without NaNs', () => {
    const m = model(1);
    const fb = render(radialWash, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 200)] }), { width: 400 });
    expect(litCount(fb)).toBeGreaterThan(0);
  });
});

describe('wipe-3d', () => {
  it('wipe-mode coverage grows monotonically as the plane sweeps', () => {
    const m = model(2);
    const params = { mode: 'wipe', axis: 'x', speed: 1 };
    const early = litCount(render(wipe3d, m, ctx(m, { timeMs: 50 }), params));
    const mid = litCount(render(wipe3d, m, ctx(m, { timeMs: 400 }), params));
    expect(mid).toBeGreaterThanOrEqual(early);
  });
});

describe('meter-eq', () => {
  it('lights more hoops as level rises (0 none, 1 all)', () => {
    const m = model(1, 4);
    expect(litCount(render(meterEq, m, ctx(m), { level: 0 }))).toBe(0);
    const half = litCount(render(meterEq, m, ctx(m), { level: 0.5 }));
    const full = litCount(render(meterEq, m, ctx(m), { level: 1 }));
    expect(full).toBe(m.pixelCount);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });
});

describe('pixel-accum', () => {
  it('lights at most addPerHit pixels per hit and is seed-deterministic', () => {
    const m = model(1);
    const params = { addPerHit: 3, decayMs: 100000 };
    const s1 = pixelAccum.createState!(m);
    const s2 = pixelAccum.createState!(m);
    const triggers = [trig(1, 'd0', 36, 1, 0), trig(2, 'd0', 36, 1, 0)];
    const a = render(pixelAccum, m, ctx(m, { triggers }), params, s1);
    const b = render(pixelAccum, m, ctx(m, { triggers }), params, s2);
    expect(litCount(a)).toBeLessThanOrEqual(2 * 3);
    expect(litCount(a)).toBeGreaterThan(0);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });
});

describe('colour-melody', () => {
  it('maps each note to a hue, held, and repeatable', () => {
    const m = model(1);
    const hueOf = (note: number) => {
      const fb = render(colourMelody, m, ctx(m, { triggers: [trig(1, 'd0', note, 1, 0)] }));
      const j = m.pixels[0]!.id * 4;
      return [fb.rgba[j]!, fb.rgba[j + 1]!, fb.rgba[j + 2]!].join(',');
    };
    expect(hueOf(0)).not.toBe(hueOf(120));
    expect(hueOf(60)).toBe(hueOf(60));
  });
});

describe('strobe', () => {
  it('is fully on during the on-phase and dark during the off-phase', () => {
    const m = model(1);
    // rate 10 Hz -> half-period 50ms. t=0 on, t=60ms off.
    expect(litCount(render(strobe, m, ctx(m, { timeMs: 0 }), { rate: 10 }))).toBe(m.pixelCount);
    expect(litCount(render(strobe, m, ctx(m, { timeMs: 60 }), { rate: 10 }))).toBe(0);
  });
});

describe('all effects', () => {
  it('never emit NaN or out-of-range channel values', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 0.8, 30), trig(2, 'd1', 38, 1, 120)];
    for (const e of listEffects()) {
      const fb = render(e, m, ctx(m, { timeMs: 250, transport: transport(2.3, 250), triggers }));
      for (let i = 0; i < fb.rgba.length; i++) {
        const v = fb.rgba[i]!;
        expect(Number.isFinite(v), e.id).toBe(true);
        expect(v >= 0 && v <= 1, `${e.id} channel ${i} = ${v}`).toBe(true);
      }
    }
  });
});
