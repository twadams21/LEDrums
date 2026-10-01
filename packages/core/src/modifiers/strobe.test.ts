import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { defaultParams, pnum, type ResolvedParams } from '../effects/types';
import { applyModifierChain } from './chain';
import { strobe, strobePeriodMs } from './impl/strobe';
import type { PixelRange, ResolvedModifier } from './types';

/* Effect-chains S02 §2 — Strobe off state (black | dim | colour) and fade. Driven through the
   chain runner (the seam every voice and the section master use), on a hand-built strip. */

const N = 6;
const model = { pixelCount: N } as unknown as PixelModel;
const range: PixelRange = { start: 0, end: N };

/** A lit strip with distinct per-pixel colour and partial coverage on one pixel. */
function src(): Framebuffer {
  const fb = new Framebuffer(N);
  for (let i = 0; i < N; i++) fb.set(i, 0.1 + i * 0.1, 0.8 - i * 0.1, 0.5, i === 2 ? 0.5 : 1);
  return fb;
}

function run(params: ResolvedParams, timeMs: number): Float32Array {
  const fb = src();
  const chain: ResolvedModifier[] = [{ modifierId: 'strobe', params }];
  applyModifierChain(chain, [], fb, range, model, timeMs, 16);
  return fb.rgba;
}

/** Frozen copy of the pre-change Strobe apply (rate/duty hard gate to black) — the golden. */
function legacyStrobe(params: ResolvedParams, timeMs: number): Float32Array {
  const fb = src();
  const rate = pnum(params, 'rate', 8);
  const duty = pnum(params, 'duty', 0.5);
  if (rate <= 0 || duty >= 1) return fb.rgba;
  const periodMs = 1000 / rate;
  const phase = ((timeMs % periodMs) + periodMs) % periodMs / periodMs;
  if (duty > 0 && phase < duty) return fb.rgba;
  fb.rgba.fill(0, range.start * 4, range.end * 4);
  return fb.rgba;
}

const TIMES = [0, 1, 16, 33, 49.5, 60, 62.5, 99.9, 124, 250, 777, 1234.5, 10_000, -40];

describe('Strobe — identity at defaults', () => {
  it('default params are bit-identical to the pre-change hard gate across the cycle', () => {
    const defaults = defaultParams(strobe.paramSpec);
    expect(defaults).toMatchObject({ offMode: 'black', fade: 0 });
    for (const t of TIMES) expect([...run(defaults, t)]).toEqual([...legacyStrobe(defaults, t)]);
  });

  it('legacy rate/duty-only params (no new keys) stay bit-identical', () => {
    for (const p of [{ rate: 10, duty: 0.5 }, { rate: 7, duty: 0.4 }, { rate: 3, duty: 0 }, { rate: 0, duty: 0.5 }, { rate: 10, duty: 1 }]) {
      for (const t of TIMES) expect([...run(p, t)]).toEqual([...legacyStrobe(p, t)]);
    }
  });
});

describe('Strobe — off state', () => {
  // rate 10 Hz → 100 ms period; duty 0.5 → on for 0..50 ms, off for 50..100 ms.
  const on = 10;
  const off = 70;

  it('dim: the off window shows input × offLevel, coverage kept; the on window is the input', () => {
    const p = { rate: 10, duty: 0.5, offMode: 'dim', offLevel: 0.25 };
    const input = src().rgba;
    const dimmed = run(p, off);
    for (let i = 0; i < N; i++) {
      const j = i * 4;
      expect(dimmed[j]).toBeCloseTo(input[j]! * 0.25, 6);
      expect(dimmed[j + 1]).toBeCloseTo(input[j + 1]! * 0.25, 6);
      expect(dimmed[j + 2]).toBeCloseTo(input[j + 2]! * 0.25, 6);
      expect(dimmed[j + 3]).toBe(input[j + 3]);
    }
    expect([...run(p, on)]).toEqual([...input]);
  });

  it('colour: alternates between the input and offColor (fully covered)', () => {
    const p = { rate: 10, duty: 0.5, offMode: 'colour', offColor: '#ff0000' };
    expect([...run(p, on)]).toEqual([...src().rgba]);
    const offFrame = run(p, off);
    for (let i = 0; i < N; i++) expect([...offFrame.subarray(i * 4, i * 4 + 4)]).toEqual([1, 0, 0, 1]);
  });

  it('black: the off window blanks to transparent black', () => {
    expect([...run({ rate: 10, duty: 0.5, offMode: 'black' }, off)]).toEqual(new Array(N * 4).fill(0));
  });
});

describe('Strobe — fade', () => {
  const base = { rate: 10, duty: 0.5, fade: 1 };
  const px0 = (p: Record<string, number | string>, t: number): number => run(p, t)[0]!;
  const inR = src().rgba[0]!;

  it('fade > 0 gives intermediate values at the flash edges (black mode)', () => {
    // On slice 0..50 ms; fade 1 → edge width 25 % of the slice (12.5 ms).
    const riseMid = px0(base, 6); // inside the soft rise
    const fallMid = px0(base, 44); // inside the soft fall
    for (const v of [riseMid, fallMid]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(inR);
    }
    expect(px0(base, 0)).toBe(0); // flash starts from the off state
    expect(px0(base, 70)).toBe(0); // off window is still off
  });

  it('per-flash decay: the flash body sags after its peak', () => {
    expect(px0(base, 12.5)).toBeCloseTo(inR, 6); // peak, end of the rise
    expect(px0(base, 37.5)).toBeCloseTo(inR * 0.5, 6); // body decayed to 1 − fade/2
    expect(px0(base, 25)).toBeLessThan(px0(base, 12.5));
    expect(px0(base, 25)).toBeGreaterThan(px0(base, 37.5));
  });

  it('the envelope is continuous: no frame-to-frame jump larger than a small step', () => {
    let prev = px0(base, 0);
    for (let t = 0.5; t <= 100; t += 0.5) {
      const v = px0(base, t);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  });

  it('fade applies to dim and colour off states too', () => {
    const dim = run({ ...base, offMode: 'dim', offLevel: 0.2 }, 6)[0]!;
    expect(dim).toBeGreaterThan(inR * 0.2);
    expect(dim).toBeLessThan(inR);
    const col = run({ ...base, offMode: 'colour', offColor: '#ffffff' }, 6);
    expect(col[0]).toBeGreaterThan(inR);
    expect(col[0]).toBeLessThan(1);
    expect(col[2 * 4 + 3]).toBeGreaterThan(0.5); // partial coverage blends toward full
    expect(col[2 * 4 + 3]).toBeLessThan(1);
  });

  it('is deterministic from the voice clock', () => {
    const p = { rate: 7, duty: 0.35, fade: 0.6, offMode: 'colour', offColor: '#20c0ff' };
    for (const t of TIMES) expect([...run(p, t)]).toEqual([...run(p, t)]);
  });
});

/* Speed in Hz or in divisions (Tim, 2026-10-01: "an option for the speed to be either in Hz or
   subdivisions, as it is with splice and slice"). */
describe('Strobe speed: Hz or a division of the tempo', () => {
  const lit = (rgba: Float32Array): boolean => rgba[3]! > 0;
  function runAt(params: ResolvedParams, timeMs: number, bpm?: number): Float32Array {
    const fb = src();
    applyModifierChain([{ modifierId: 'strobe', params }], [], fb, range, model, timeMs, 16, bpm === undefined ? undefined : { phase: 0, timeMs, bpm });
    return fb.rgba;
  }

  it('Hz is the default — a show saved before this reads back unchanged', () => {
    expect(defaultParams(strobe.paramSpec).rateMode).toBe('hz');
    expect(strobePeriodMs({ rate: 8 }, 140)).toBe(125);
  });

  it('a division flashes once per division at the tempo: 1/4 at 120 bpm = 500 ms', () => {
    const p = { ...defaultParams(strobe.paramSpec), rateMode: 'beats', division: '1/4', duty: 0.5 };
    expect(strobePeriodMs(p, 120)).toBe(500);
    expect(lit(runAt(p, 100, 120))).toBe(true); // first half of the beat: on
    expect(lit(runAt(p, 300, 120))).toBe(false); // second half: off
    expect(lit(runAt(p, 600, 120))).toBe(true); // next beat
  });

  it('follows the tempo: the same 1/4 at 60 bpm is a 1000 ms cycle', () => {
    const p = { ...defaultParams(strobe.paramSpec), rateMode: 'beats', division: '1/4', duty: 0.5 };
    expect(strobePeriodMs(p, 60)).toBe(1000);
    expect(lit(runAt(p, 300, 60))).toBe(true); // still the on half at 60 bpm
  });

  it('with no tempo from the host, a division reads at 120 bpm', () => {
    expect(strobePeriodMs({ rateMode: 'beats', division: '1/16' }, undefined)).toBe(125);
  });
});
