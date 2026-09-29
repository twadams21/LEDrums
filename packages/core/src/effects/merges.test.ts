/**
 * S03 §2 merges (effect-chains wave 2, piece gen-merges).
 *
 * - wave-collapse → radial-wash `mode: 'collapse'`
 * - follow-hoop → whole-drum `hoopDelayMs` (the Solid "Simple" Style)
 *
 * Three kinds of proof:
 * 1. Defaults are bit-identical to before the merge: framebuffer digests pinned from the
 *    pre-merge implementation (base 83c292d6) across a scenario table.
 * 2. The merged mode / param reproduces the merged-away effect at matched params.
 * 3. Where the two cannot match, the exact delta is asserted, not hand-waved.
 */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { getEffect } from './registry';
import { wholeDrum } from './impl/whole-drum';
import { followHoop } from './impl/follow-hoop';
import { radialWash, waveRadius } from './impl/radial-wash';
import { waveCollapse, collapseRadius } from './impl/wave-collapse';

function model(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'd0', diameterIn: 14, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'd1', diameterIn: 10, hoopSpacingMm: 60, origin: { x: 500, y: 100, z: 0 }, rotation: { x: 0.3, y: 0, z: 0 } },
      ],
    }),
  );
}

function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

function ctx(m: PixelModel, triggers: Trigger[], extra: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: 0,
    dt: 16,
    transport: { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
    triggers,
    ...extra,
  };
}

function render(effect: EffectGenerator, m: PixelModel, c: RenderContext, params: ResolvedParams = {}): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  effect.render(c, { ...defaultParams(effect.paramSpec), ...params }, fb, undefined);
  return fb;
}

/** FNV-1a over the framebuffer's raw float bytes: equal digest ⇔ bit-identical frame. */
function digest(fb: Framebuffer): string {
  const bytes = new Uint8Array(fb.rgba.buffer, fb.rgba.byteOffset, fb.rgba.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) if (fb.rgba[i * 4 + 3]! > 0) n++;
  return n;
}

const m = model();
const HITS = (age: number): Trigger[] => [trig(1, 'd0', 36, 1, age), trig(2, 'd1', 64, 0.7, age + 37)];

// --- 1. defaults bit-identical to pre-merge ------------------------------------

/** [name, effect, params, ageMs, authoredDecay] → digest recorded on the pre-merge base. */
const IDENTITY: Array<[string, EffectGenerator, ResolvedParams, number, boolean, string]> = [
  ['whole-drum defaults age 0', wholeDrum, {}, 0, false, 'adf92705'],
  ['whole-drum defaults age 120', wholeDrum, {}, 120, false, 'daf5a625'],
  ['whole-drum noteHue age 60', wholeDrum, { noteHue: true, saturation: 0.6 }, 60, false, 'd0ca0965'],
  ['whole-drum authoredDecay age 900', wholeDrum, {}, 900, true, '0e989905'],
  ['radial-wash out age 150', radialWash, {}, 150, false, '7e8fe9ad'],
  ['radial-wash in age 300', radialWash, { mode: 'in', brightness: 0.5 }, 300, false, '2c999307'],
  ['radial-wash bounce age 1400', radialWash, { mode: 'bounce', width: 300 }, 1400, false, '23659da9'],
  ['radial-wash out authoredDecay', radialWash, {}, 700, true, '22166c84'],
];

describe('merge defaults are bit-identical to the pre-merge implementations', () => {
  it.each(IDENTITY)('%s', (_name, effect, params, age, authoredDecay, expected) => {
    const fb = render(effect, m, ctx(m, HITS(age), authoredDecay ? { authoredDecay } : {}), params);
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(digest(fb)).toBe(expected);
  });
});

// --- 2. wave-collapse → radial-wash `collapse` --------------------------------

/** Wave-collapse params, mapped 1:1 onto radial-wash (same keys, same meaning). */
const COLLAPSE_CASES: ResolvedParams[] = [
  { hue: 320, saturation: 1, brightness: 1, speed: 1.2, width: 180, reach: 1200, decayMs: 600 },
  { hue: 40, saturation: 0.5, brightness: 1, speed: 2.5, width: 400, reach: 700, decayMs: 1500 },
  { hue: 200, saturation: 1, brightness: 1, speed: 1, width: 800, reach: 0, decayMs: 2000 },
];
const COLLAPSE_AGES = [0, 90, 500, 1000, 1300, 2200];

describe('radial-wash collapse reproduces wave-collapse', () => {
  it('its radius is wave-collapse’s radius at every age', () => {
    // reach ≥ 1: wave-collapse clamps reach to 1 before calling collapseRadius; the `collapse`
    // case applies that clamp itself (the reach-0 render case below covers it end to end).
    for (const reach of [1, 700, 1200]) {
      for (const age of [0, 1, 333, 999, 1000, 1001, 2500, 7777]) {
        expect(waveRadius('collapse', age, 1.2, reach)).toBe(collapseRadius(age, 1.2, reach));
      }
    }
  });

  it.each(COLLAPSE_CASES)('is bit-identical to wave-collapse at brightness 1 (%o)', (params) => {
    let litFrames = 0;
    for (const age of COLLAPSE_AGES) {
      for (const authoredDecay of [false, true]) {
        const c = ctx(m, HITS(age), { authoredDecay });
        const wc = render(waveCollapse, m, c, params);
        const rw = render(radialWash, m, c, { ...params, mode: 'collapse' });
        if (litCount(wc) > 0) litFrames++;
        expect(digest(rw), `age ${age} authoredDecay ${authoredDecay}`).toBe(digest(wc));
      }
    }
    expect(litFrames).toBeGreaterThanOrEqual(COLLAPSE_AGES.length);
  });

  it('below brightness 1, RGB matches and only alpha / the visibility cut differ by the brightness factor', () => {
    const bri = 0.5;
    const params = { ...COLLAPSE_CASES[0], brightness: bri };
    const c = ctx(m, HITS(300));
    const wc = render(waveCollapse, m, c, params);
    const rw = render(radialWash, m, c, { ...params, mode: 'collapse' });
    let compared = 0;
    for (let i = 0; i < m.pixelCount; i++) {
      const j = i * 4;
      const a = wc.rgba[j + 3]!;
      const b = rw.rgba[j + 3]!;
      if (a > 0) {
        // Same RGB; radial-wash's alpha is intensity, wave-collapse's is intensity × brightness.
        expect([rw.rgba[j], rw.rgba[j + 1], rw.rgba[j + 2]]).toEqual([wc.rgba[j], wc.rgba[j + 1], wc.rgba[j + 2]]);
        expect(b * bri).toBeCloseTo(a, 6);
        compared++;
      } else if (b > 0) {
        // Lit only by radial-wash: its intensity clears the 0.004 cut, intensity × brightness does not.
        expect(b * bri).toBeLessThan(0.004);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('offers collapse as a Mode option on the registered effect, default still out', () => {
    const mode = getEffect('radial-wash').paramSpec.find((s) => s.key === 'mode');
    expect(mode?.options).toEqual(['out', 'in', 'bounce', 'collapse']);
    expect(mode?.default).toBe('out');
  });
});

// --- 3. follow-hoop → whole-drum `hoopDelayMs` ("Simple") ---------------------

/** Follow-hoop params and their whole-drum equivalent (`delayMs` is `hoopDelayMs` there). */
const HOOP_CASES: Array<{ fh: ResolvedParams; wd: ResolvedParams }> = [
  {
    fh: { hue: 140, saturation: 1, brightness: 1, delayMs: 90, decayMs: 300 },
    wd: { hue: 140, saturation: 1, brightness: 1, hoopDelayMs: 90, decayMs: 300 },
  },
  {
    fh: { hue: 10, saturation: 0.4, brightness: 0.7, delayMs: 25, decayMs: 900 },
    wd: { hue: 10, saturation: 0.4, brightness: 0.7, hoopDelayMs: 25, decayMs: 900 },
  },
];
const HOOP_AGES = [0, 30, 95, 181, 270, 600];

describe('whole-drum hoopDelayMs reproduces follow-hoop', () => {
  it.each(HOOP_CASES)('is bit-identical to follow-hoop at matched params ($wd)', ({ fh, wd }) => {
    for (const age of HOOP_AGES) {
      const c = ctx(m, HITS(age));
      const follow = render(followHoop, m, c, fh);
      expect(litCount(follow)).toBeGreaterThan(0);
      expect(digest(render(wholeDrum, m, c, wd)), `age ${age}`).toBe(digest(follow));
    }
  });

  it('cascades: before one delay has passed only hoop 1 is lit', () => {
    const fb = render(wholeDrum, m, ctx(m, [trig(1, 'd0', 36, 1, 10)]), { hoopDelayMs: 100 });
    const lit = new Set<number>();
    for (const p of m.pixels) if (fb.rgba[p.id * 4 + 3]! > 0) lit.add(p.hoopIndex);
    expect([...lit]).toEqual([1]);
  });

  it('keeps noteHue working with a hoop delay', () => {
    const c = ctx(m, [trig(1, 'd0', 127, 1, 5)]);
    const red = render(wholeDrum, m, c, { hoopDelayMs: 50, noteHue: false, hue: 0 });
    const noted = render(wholeDrum, m, c, { hoopDelayMs: 50, noteHue: true, hue: 180 });
    expect(digest(noted)).toBe(digest(red)); // note 127 → hue 360 ≡ 0, overriding hue 180
  });

  it('differs from follow-hoop only under an authored envelope: each lit hoop holds at full', () => {
    const { fh, wd } = HOOP_CASES[0]!;
    const c = ctx(m, [trig(1, 'd0', 36, 1, 200)], { authoredDecay: true });
    const simple = render(wholeDrum, m, c, wd);
    const follow = render(followHoop, m, c, fh);
    for (const p of m.pixels.filter((q) => q.drumId === 'd0')) {
      const lit = 200 - (p.hoopIndex - 1) * 90 >= 0;
      expect(simple.rgba[p.id * 4 + 3]).toBe(lit ? 1 : 0);
    }
    expect(digest(simple)).not.toBe(digest(follow));
  });

  it('declares hoopDelayMs defaulting to 0 on the registered effect', () => {
    const spec = getEffect('whole-drum').paramSpec.find((s) => s.key === 'hoopDelayMs');
    expect(spec).toMatchObject({ type: 'number', default: 0, min: 0 });
  });
});
