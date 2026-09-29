import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain, applyScopedModifierChain } from './chain';
import type { ModifierEnvelope, PixelRange, ResolvedModifier } from './types';

/* Effect chains S02 §1 — per-link dry/wet mix and the per-link ADSR envelope, driven through
   the chain runner's public entry points (the seam the compositor and generator bridge call). */

const N = 8;
const model = { pixelCount: N } as unknown as PixelModel;
const whole: PixelRange = { start: 0, end: N };

/** Distinct, non-trivial colours per pixel so a lerp error cannot hide behind symmetry. */
function input(): Framebuffer {
  const fb = new Framebuffer(N);
  for (let i = 0; i < N; i++) fb.set(i, 0.2 + i * 0.1, 0.9 - i * 0.1, 0.5, 1);
  return fb;
}

const pixels = (fb: Framebuffer): number[] => Array.from(fb.rgba);
const black: ResolvedModifier = { modifierId: 'levels', params: { saturation: 1, brightness: 0, invert: false } };
const hue: ResolvedModifier = { modifierId: 'hue-shift', params: { hue: 120, mode: 'shift' } };
const env = (e: Partial<ModifierEnvelope>): ModifierEnvelope => ({
  attackMs: 0, decayMs: 0, sustainLevel: 1, releaseMs: 0, ...e,
});

function run(chain: ResolvedModifier[], timeMs = 0, fb = input()): Framebuffer {
  applyModifierChain(chain, [], fb, whole, model, timeMs, 16);
  return fb;
}

/** Expected `dry + (wet − dry) × t` per channel. */
function lerped(dry: Framebuffer, wet: Framebuffer, t: number): number[] {
  return pixels(dry).map((d, j) => d + (wet.rgba[j]! - d) * t);
}

describe('modifier chain mix', () => {
  it('mix 1 with no envelope is bit-identical to a link without mix, for stateless and stateful modifiers', () => {
    const trail: ResolvedModifier = { modifierId: 'trail', params: { decayMs: 250, mode: 'add' } };
    for (const base of [black, hue, trail]) {
      const plainState: unknown[] = [];
      const mixedState: unknown[] = [];
      const plain = input();
      const mixed = input();
      for (let f = 0; f < 5; f++) {
        applyModifierChain([base], plainState, plain, whole, model, f * 16, 16);
        applyModifierChain([{ ...base, mix: 1 }], mixedState, mixed, whole, model, f * 16, 16);
        expect(pixels(mixed)).toEqual(pixels(plain));
      }
    }
  });

  it('mix above 1 behaves as fully wet', () => {
    expect(pixels(run([{ ...hue, mix: 3 }]))).toEqual(pixels(run([hue])));
  });

  it('mix 0.5 on levels (brightness 0) gives the midpoint of dry and black', () => {
    const out = run([{ ...black, mix: 0.5 }]);
    const dry = input();
    expect(pixels(out)).toEqual(pixels(dry).map((v, j) => (j % 4 === 3 ? v : v * 0.5)));
  });

  it('mix 0.5 on hue-shift gives the midpoint of dry and the fully shifted output', () => {
    const out = run([{ ...hue, mix: 0.5 }]);
    const expected = lerped(input(), run([hue]), 0.5);
    out.rgba.forEach((v, j) => expect(v).toBeCloseTo(expected[j]!, 6));
  });

  it('mix 0 (or negative) leaves the dry input untouched', () => {
    expect(pixels(run([{ ...hue, mix: 0 }]))).toEqual(pixels(input()));
    expect(pixels(run([{ ...hue, mix: -1 }]))).toEqual(pixels(input()));
  });

  it('mixes each link on its own input, in chain order', () => {
    // black at 0.5 halves the input; hue-shift fully wet then runs on the halved frame.
    const out = run([{ ...black, mix: 0.5 }, hue]);
    const expected = run([hue], 0, run([{ ...black, mix: 0.5 }]));
    expect(pixels(out)).toEqual(pixels(expected));
  });
});

describe('modifier chain envelope', () => {
  it('sustain 0 gives the full effect at the end of the attack and none once the decay has run', () => {
    const link: ResolvedModifier = { ...black, envelope: env({ attackMs: 10, decayMs: 20, sustainLevel: 0 }) };
    expect(pixels(run([link], 10))).toEqual(pixels(run([black])));
    expect(pixels(run([link], 30))).toEqual(pixels(input()));
    expect(pixels(run([link], 500))).toEqual(pixels(input()));
  });

  it('ramps through the attack and decays to the sustain level', () => {
    const link: ResolvedModifier = { ...black, envelope: env({ attackMs: 100, decayMs: 100, sustainLevel: 0.5 }) };
    const dry = input();
    const scaleAt = (t: number) => run([link], t).rgba[0]! / dry.rgba[0]!;
    expect(scaleAt(0)).toBeCloseTo(1, 6); // gain 0 → dry
    expect(scaleAt(50)).toBeCloseTo(0.5, 6); // half-way up the attack
    expect(scaleAt(150)).toBeCloseTo(0.25, 6); // half-way down to 0.5 → gain 0.75
    expect(scaleAt(1000)).toBeCloseTo(0.5, 6); // sustain 0.5 held
  });

  it('multiplies the mix', () => {
    const link: ResolvedModifier = { ...black, mix: 0.5, envelope: env({ sustainLevel: 0.5 }) };
    const dry = input();
    expect(run([link], 40).rgba[0]! / dry.rgba[0]!).toBeCloseTo(0.75, 6);
  });

  it('with a gate length, releases from the level held at the gate to 0', () => {
    const link: ResolvedModifier = { ...black, envelope: env({ sustainLevel: 0.8, lengthMs: 100, releaseMs: 40 }) };
    const dry = input();
    const scaleAt = (t: number) => run([link], t).rgba[0]! / dry.rgba[0]!;
    expect(scaleAt(99)).toBeCloseTo(0.2, 6);
    expect(scaleAt(120)).toBeCloseTo(0.6, 6); // gain 0.4, half-way through the release
    expect(scaleAt(140)).toBeCloseTo(1, 6);
    expect(scaleAt(10_000)).toBeCloseTo(1, 6);
  });

  it('a gate that cuts into the attack releases from the partial attack level', () => {
    const link: ResolvedModifier = { ...black, envelope: env({ attackMs: 100, lengthMs: 50, releaseMs: 50 }) };
    const dry = input();
    expect(run([link], 75).rgba[0]! / dry.rgba[0]!).toBeCloseTo(0.75, 6); // 0.5 → half released
  });

  it('an envelope at full gain is bit-identical to the plain link', () => {
    const link: ResolvedModifier = { ...hue, envelope: env({}) };
    expect(pixels(run([link], 5))).toEqual(pixels(run([hue], 5)));
  });
});

describe('scoped modifier chain mix', () => {
  it('range-local links mix each selected run and leave pixels outside the scope alone', () => {
    const ranges: PixelRange[] = [{ start: 1, end: 3 }, { start: 5, end: 7 }];
    const fb = input();
    applyScopedModifierChain([{ ...black, mix: 0.5 }], [], fb, ranges, model, 0, 16);
    const dry = input();
    const inScope = (i: number) => ranges.some((r) => i >= r.start && i < r.end);
    pixels(dry).forEach((v, j) => {
      const halved = inScope(Math.floor(j / 4)) && j % 4 !== 3;
      expect(fb.rgba[j]).toBe(Math.fround(halved ? v * 0.5 : v));
    });
  });

  it('full-output links mix over the whole frame', () => {
    const trail: ResolvedModifier = { modifierId: 'trail', params: { decayMs: 250, mode: 'add' } };
    const ranges: PixelRange[] = [{ start: 2, end: 4 }];
    const wetState: unknown[] = [];
    const mixState: unknown[] = [];
    const frames = [input(), new Framebuffer(N), new Framebuffer(N)];
    for (let f = 0; f < frames.length; f++) {
      const wet = new Framebuffer(N);
      wet.rgba.set(frames[f]!.rgba);
      const mixed = new Framebuffer(N);
      mixed.rgba.set(frames[f]!.rgba);
      applyScopedModifierChain([trail], wetState, wet, ranges, model, f * 16, 16);
      applyScopedModifierChain([{ ...trail, mix: 0.5 }], mixState, mixed, ranges, model, f * 16, 16);
      const expected = lerped(frames[f]!, wet, 0.5);
      mixed.rgba.forEach((v, j) => expect(v).toBeCloseTo(expected[j]!, 6));
    }
  });
});
