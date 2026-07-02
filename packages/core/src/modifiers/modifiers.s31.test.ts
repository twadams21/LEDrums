import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { rgbToHsv } from '../color/color';
import { applyModifierChain } from './chain';
import { echo } from './impl/echo';
import { pixelate } from './impl/pixelate';
import { mirror } from './impl/mirror';
import { hueShift } from './impl/hue-shift';
import { levels } from './impl/levels';
import { getModifier } from './registry';
import type { ModifierDef, PixelRange, ResolvedModifier } from './types';

// S31 modifier goldens. These pin the pure apply of each new modifier (Echo, Pixelate,
// Mirror, HueShift, Levels) and drive them through the shared chain runner so bypass = identity
// and lazy per-voice state come along for free. No modifier reads model geometry in apply, so a
// light stub model suffices; only Echo's createState sizes its ring to the range length.

const model = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const range = (start: number, end: number): PixelRange => ({ start, end });
const f32 = (a: number[]): number[] => a.map((x) => Math.fround(x));

/** A framebuffer whose channel-0 values are `vals` (other channels 0, alpha 1). */
function fbFrom(vals: number[]): Framebuffer {
  const fb = new Framebuffer(vals.length);
  for (let i = 0; i < vals.length; i++) fb.set(i, vals[i]!, 0, 0, 1);
  return fb;
}
/** Channel-0 across all pixels. */
function ch0(fb: Framebuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) out.push(fb.rgba[i * 4]!);
  return out;
}

/** Apply a single modifier once to a fresh framebuffer of `vals` (whole-buffer range). */
function once(def: ModifierDef<any>, params: Record<string, unknown>, vals: number[]): number[] {
  const link: ResolvedModifier = { modifierId: def.id, params: params as ResolvedModifier['params'] };
  const fb = fbFrom(vals);
  applyModifierChain([link], [], fb, range(0, vals.length), model(vals.length), 0, 16);
  return ch0(fb);
}

/** Bypass = identity: a bypassed link of `def` must leave the framebuffer untouched. */
function expectBypassIdentity(def: ModifierDef<any>, params: Record<string, unknown>): void {
  const vals = [0.6, 0.1, 0.9, 0.3];
  const link: ResolvedModifier = {
    modifierId: def.id,
    params: params as ResolvedModifier['params'],
    bypass: true,
  };
  const fb = fbFrom(vals);
  applyModifierChain([link], [], fb, range(0, vals.length), model(vals.length), 0, 16);
  expect(ch0(fb)).toEqual(f32(vals));
}

// ---------------------------------------------------------------------------------------------
// Echo — delayed decaying ghosts (temporal ring buffer)
// ---------------------------------------------------------------------------------------------

/** Drive Echo across ticks on a 1-pixel buffer; returns channel-0 out after each tick. */
function echoTicks(params: Record<string, unknown>, inputs: number[], dt: number): number[] {
  const state: unknown[] = [];
  const link: ResolvedModifier = { modifierId: 'echo', params: params as ResolvedModifier['params'] };
  const out: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const fb = fbFrom([inputs[i]!]);
    applyModifierChain([link], state, fb, range(0, 1), model(1), i * dt, dt);
    out.push(fb.rgba[0]!);
  }
  return out;
}

describe('Echo modifier — temporal ring buffer goldens', () => {
  it('delay = 1 slot: an impulse leaves a feedback train decaying by `feedback` each tick', () => {
    // delayMs/dt = 1 → the ghost re-enters one tick later, scaled by feedback, and repeats.
    const out = echoTicks({ delayMs: 100, feedback: 0.5 }, [1, 0, 0, 0], 100);
    expect(out).toEqual(f32([1, 0.5, 0.25, 0.125]));
  });

  it('delay = 2 slots: the ghost lands every 2 ticks (temporal state pinned across ticks)', () => {
    const out = echoTicks({ delayMs: 200, feedback: 0.5 }, [1, 0, 0, 0, 0], 100);
    expect(out).toEqual(f32([1, 0, 0.5, 0, 0.25]));
  });

  it('the delay line is initially cold: the first frame is untouched (no history yet)', () => {
    const out = echoTicks({ delayMs: 100, feedback: 0.9 }, [0.4], 100);
    expect(out).toEqual(f32([0.4]));
  });

  it('the summed feedback clamps to 1', () => {
    const out = echoTicks({ delayMs: 100, feedback: 0.95 }, [0.8, 0.8, 0.8, 0.8, 0.8], 100);
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
    expect(out[out.length - 1]).toBe(1);
  });

  it('is deterministic across separate runs', () => {
    const run = (): number[] => echoTicks({ delayMs: 130, feedback: 0.6 }, [0.7, 0.2, 0.9, 0, 0.4], 33);
    expect(run()).toEqual(run());
  });

  it('bypass = identity', () => expectBypassIdentity(echo, { delayMs: 100, feedback: 0.5 }));
});

// ---------------------------------------------------------------------------------------------
// Pixelate — spatial block averaging
// ---------------------------------------------------------------------------------------------

describe('Pixelate modifier — block-average goldens', () => {
  it('size = 1 is identity (each block is one pixel)', () => {
    expect(once(pixelate, { size: 1 }, [0.1, 0.8, 0.3, 0.5])).toEqual(f32([0.1, 0.8, 0.3, 0.5]));
  });

  it('size = 2 flattens each pair to its average', () => {
    expect(once(pixelate, { size: 2 }, [1, 0, 0.5, 0.5])).toEqual(f32([0.5, 0.5, 0.5, 0.5]));
  });

  it('a trailing partial block averages only its own pixels', () => {
    // Blocks of 2 over 5 px: [1,0]→0.5, [0.4,0.6]→0.5, [0.9]→0.9 (partial).
    expect(once(pixelate, { size: 2 }, [1, 0, 0.4, 0.6, 0.9])).toEqual(f32([0.5, 0.5, 0.5, 0.5, 0.9]));
  });

  it('respects a sub-range: only the voice range is touched, blocks anchored at range.start', () => {
    const fb = fbFrom([0.2, 1, 0, 0.9]);
    applyModifierChain([{ modifierId: 'pixelate', params: { size: 2 } }], [], fb, range(1, 3), model(4), 0, 16);
    // pixel 0 and 3 untouched; the single block [1,0] over pixels 1..2 averages to 0.5.
    expect(ch0(fb)).toEqual(f32([0.2, 0.5, 0.5, 0.9]));
  });

  it('bypass = identity', () => expectBypassIdentity(pixelate, { size: 3 }));
});

// ---------------------------------------------------------------------------------------------
// Mirror — spatial reflection with an ENUM axis (S18 Select control)
// ---------------------------------------------------------------------------------------------

describe('Mirror modifier — axis enum goldens', () => {
  it('flip reverses the range end-to-end', () => {
    expect(once(mirror, { axis: 'flip' }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.4, 0.3, 0.2, 0.1]));
  });

  it('low mirrors the low half onto the high half (symmetric)', () => {
    expect(once(mirror, { axis: 'low' }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.1, 0.2, 0.2, 0.1]));
  });

  it('high mirrors the high half onto the low half (symmetric)', () => {
    expect(once(mirror, { axis: 'high' }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.4, 0.3, 0.3, 0.4]));
  });

  it('odd length keeps the centre pixel fixed', () => {
    expect(once(mirror, { axis: 'low' }, [0.1, 0.2, 0.3])).toEqual(f32([0.1, 0.2, 0.1]));
  });

  it('the axis param is an S18 Select-compatible enum spec', () => {
    const spec = mirror.paramSpec.find((s) => s.key === 'axis');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('enum');
    expect(Array.isArray(spec!.options)).toBe(true);
    expect(spec!.options).toEqual(['low', 'high', 'flip']);
    expect(spec!.options).toContain(spec!.default);
  });

  it('bypass = identity', () => expectBypassIdentity(mirror, { axis: 'flip' }));
});

// ---------------------------------------------------------------------------------------------
// Hue Shift / Colorize — enum mode
// ---------------------------------------------------------------------------------------------

describe('HueShift modifier — hue rotation goldens', () => {
  /** Apply HueShift to a single RGB pixel and read back the RGB. */
  function hue(params: Record<string, unknown>, rgb: [number, number, number]): [number, number, number] {
    const fb = new Framebuffer(1);
    fb.set(0, rgb[0], rgb[1], rgb[2], 1);
    applyModifierChain([{ modifierId: 'hue-shift', params: params as ResolvedModifier['params'] }], [], fb, range(0, 1), model(1), 0, 16);
    return [fb.rgba[0]!, fb.rgba[1]!, fb.rgba[2]!];
  }

  it('shift by 120° rotates pure red to pure green', () => {
    const [r, g, b] = hue({ hue: 120, mode: 'shift' }, [1, 0, 0]);
    expect(r).toBeCloseTo(0, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it('colorize sets the hue absolutely while preserving saturation and value', () => {
    const [r, g, b] = hue({ hue: 240, mode: 'colorize' }, [1, 0, 0]); // full-sat, full-val red → blue
    const hsv = rgbToHsv(r, g, b);
    expect(hsv.h).toBeCloseTo(240, 3);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
  });

  it('leaves greys (no hue) unchanged', () => {
    const [r, g, b] = hue({ hue: 90, mode: 'shift' }, [0.5, 0.5, 0.5]);
    expect([r, g, b].map((x) => Math.fround(x))).toEqual(f32([0.5, 0.5, 0.5]));
  });

  it('the mode param is an S18 Select-compatible enum spec', () => {
    const spec = hueShift.paramSpec.find((s) => s.key === 'mode');
    expect(spec!.type).toBe('enum');
    expect(spec!.options).toEqual(['shift', 'colorize']);
  });

  it('bypass = identity', () => expectBypassIdentity(hueShift, { hue: 90, mode: 'shift' }));
});

// ---------------------------------------------------------------------------------------------
// Levels — saturation / brightness / invert
// ---------------------------------------------------------------------------------------------

describe('Levels modifier — saturation/brightness/invert goldens', () => {
  function levelsPx(params: Record<string, unknown>, rgb: [number, number, number]): [number, number, number] {
    const fb = new Framebuffer(1);
    fb.set(0, rgb[0], rgb[1], rgb[2], 1);
    applyModifierChain([{ modifierId: 'levels', params: params as ResolvedModifier['params'] }], [], fb, range(0, 1), model(1), 0, 16);
    return [fb.rgba[0]!, fb.rgba[1]!, fb.rgba[2]!];
  }

  it('saturation = 0 desaturates to greyscale at the same value', () => {
    const [r, g, b] = levelsPx({ saturation: 0, brightness: 1, invert: false }, [1, 0, 0]);
    // Pure red has value 1 → grey at value 1 = white.
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('brightness = 0.5 halves value', () => {
    const [r] = levelsPx({ saturation: 1, brightness: 0.5, invert: false }, [1, 0, 0]);
    expect(r).toBeCloseTo(0.5, 5);
  });

  it('invert flips each channel', () => {
    const [r, g, b] = levelsPx({ saturation: 1, brightness: 1, invert: true }, [0.8, 0.2, 0]);
    expect(r).toBeCloseTo(0.2, 5);
    expect(g).toBeCloseTo(0.8, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('all-default params are identity (up to the HSV round-trip)', () => {
    const [r, g, b] = levelsPx({ saturation: 1, brightness: 1, invert: false }, [0.8, 0.2, 0.4]);
    expect(r).toBeCloseTo(0.8, 5);
    expect(g).toBeCloseTo(0.2, 5);
    expect(b).toBeCloseTo(0.4, 5);
  });

  it('bypass = identity', () => expectBypassIdentity(levels, { saturation: 0.5, brightness: 0.5, invert: true }));
});

// ---------------------------------------------------------------------------------------------
// Registry surface
// ---------------------------------------------------------------------------------------------

describe('S31 registry surface', () => {
  it('registers all five S31 modifiers under their ids', () => {
    for (const id of ['echo', 'pixelate', 'mirror', 'hue-shift', 'levels']) {
      expect(getModifier(id).id).toBe(id);
    }
  });

  it('every S31 param spec declares valid enum options where typed enum', () => {
    for (const def of [echo, pixelate, mirror, hueShift, levels]) {
      for (const spec of def.paramSpec) {
        if (spec.type === 'enum') {
          expect(Array.isArray(spec.options)).toBe(true);
          expect(spec.options!.length).toBeGreaterThan(0);
          expect(spec.options).toContain(spec.default);
        }
      }
    }
  });
});
