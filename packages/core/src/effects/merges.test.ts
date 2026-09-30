/**
 * S03 §2 merges (effect-chains wave 2, piece gen-merges).
 *
 * - wave-collapse → radial-wash `mode: 'collapse'`
 * - follow-hoop → whole-drum `hoopDelayMs` (the Solid "Simple" Style)
 *
 * Three kinds of proof:
 * 1. Defaults are bit-identical to before the merge: framebuffer digests pinned from the
 *    pre-merge implementation (base 83c292d6) across a scenario table.
 * 2. The merged mode / param reproduces the merged-away effect at matched params. The
 *    merged-away implementations were deleted in S08 (w5b delete-merged-effects); their
 *    frames are pinned here as digests recorded from them on base 9977658c.
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
import { radialWash, waveRadius } from './impl/radial-wash';

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
/** wave-collapse's frame digest per [case][age] as [authoredDecay false, true] (deleted impl). */
const WAVE_COLLAPSE_DIGESTS: string[][][] = [
  [['956d46c5', '956d46c5'], ['956d46c5', '956d46c5'], ['96826405', 'f451d2d3'], ['1d45d2c5', 'd6459656'], ['2d11e823', 'f876ad55'], ['956d46c5', '956d46c5']],
  [['ddd1b1f3', '9d4b263e'], ['0addd3c8', '5dafbb16'], ['f1ed8e65', '12f6cd06'], ['e48bd833', '9ade5cb0'], ['73d470ae', '9fdfde64'], ['276d1af2', '4677a7c4']],
  [['edc3c1fe', 'afe046fe'], ['7780a703', 'afe046fe'], ['e0849a51', 'afe046fe'], ['9631f61c', 'afe046fe'], ['ee37a939', 'afe046fe'], ['c8a42412', 'afe046fe']],
];
/** wave-collapse's `collapseRadius(age, 1.2, reach)` as [reach, age, radius] (deleted impl). */
const COLLAPSE_RADII: Array<[number, number, number]> = [[1, 0, 1], [1, 1, 0.19999999999999996], [1, 333, 0.5999999999999659], [1, 999, 0.20000000000004547], [1, 1000, 1], [1, 1001, 0.20000000000004547], [1, 2500, 1], [1, 7777, 0.6000000000003638], [700, 0, 700], [700, 1, 698.8], [700, 333, 300.40000000000003], [700, 999, 498.79999999999995], [700, 1000, 500], [700, 1001, 501.20000000000005], [700, 2500, 500], [700, 7777, 232.39999999999964], [1200, 0, 1200], [1200, 1, 1198.8], [1200, 333, 800.4000000000001], [1200, 999, 1.2000000000000455], [1200, 1000, 0], [1200, 1001, 1.2000000000000455], [1200, 2500, 600], [1200, 7777, 932.3999999999996]];
/** wave-collapse's empty-frame digest (no pixel lit). */
const UNLIT = '956d46c5';

describe('radial-wash collapse reproduces wave-collapse', () => {
  it('its radius is wave-collapse’s radius at every age', () => {
    // reach ≥ 1: wave-collapse clamped reach to 1 before calling collapseRadius; the `collapse`
    // case applies that clamp itself (the reach-0 render case below covers it end to end).
    for (const [reach, age, radius] of COLLAPSE_RADII) expect(waveRadius('collapse', age, 1.2, reach), `reach ${reach} age ${age}`).toBe(radius);
  });

  it.each(COLLAPSE_CASES.map((params, i) => [params, i] as const))('is bit-identical to wave-collapse at brightness 1 (%o)', (params, i) => {
    let litFrames = 0;
    COLLAPSE_AGES.forEach((age, a) => {
      [false, true].forEach((authoredDecay, k) => {
        const expected = WAVE_COLLAPSE_DIGESTS[i]![a]![k]!;
        if (expected !== UNLIT) litFrames++;
        const rw = render(radialWash, m, ctx(m, HITS(age), { authoredDecay }), { ...params, mode: 'collapse' });
        expect(digest(rw), `age ${age} authoredDecay ${authoredDecay}`).toBe(expected);
      });
    });
    expect(litFrames).toBeGreaterThanOrEqual(COLLAPSE_AGES.length);
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
/** follow-hoop's frame digest per [case][age] (deleted impl). */
const FOLLOW_HOOP_DIGESTS: string[][] = [
  ['4433b8a8', 'fa4b6532', '1deb61aa', '789ef0be', 'c67a0e19', '38cf6118'],
  ['7e58342f', 'f2f9d947', 'b7e53d85', '409348a8', '5cfdfd7f', '2b10f2b6'],
];
/** follow-hoop's frame for HOOP_CASES[0] at age 200 under an authored envelope (deleted impl). */
const FOLLOW_HOOP_AUTHORED = '40edcbf2';

describe('whole-drum hoopDelayMs reproduces follow-hoop', () => {
  it.each(HOOP_CASES.map((c, i) => [c.wd, i] as const))('is bit-identical to follow-hoop at matched params (%o)', (wd, i) => {
    HOOP_AGES.forEach((age, a) => {
      const fb = render(wholeDrum, m, ctx(m, HITS(age)), wd);
      expect(litCount(fb)).toBeGreaterThan(0);
      expect(digest(fb), `age ${age}`).toBe(FOLLOW_HOOP_DIGESTS[i]![a]);
    });
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
    const { wd } = HOOP_CASES[0]!;
    const c = ctx(m, [trig(1, 'd0', 36, 1, 200)], { authoredDecay: true });
    const simple = render(wholeDrum, m, c, wd);
    for (const p of m.pixels.filter((q) => q.drumId === 'd0')) {
      const lit = 200 - (p.hoopIndex - 1) * 90 >= 0;
      expect(simple.rgba[p.id * 4 + 3]).toBe(lit ? 1 : 0);
    }
    expect(digest(simple)).not.toBe(FOLLOW_HOOP_AUTHORED);
  });

  it('declares hoopDelayMs defaulting to 0 on the registered effect', () => {
    const spec = getEffect('whole-drum').paramSpec.find((s) => s.key === 'hoopDelayMs');
    expect(spec).toMatchObject({ type: 'number', default: 0, min: 0 });
  });
});
