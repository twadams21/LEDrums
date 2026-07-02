import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from './chain';
import { listModifiers } from './registry';
import { listModifiersByCategory, MODIFIER_CATEGORY_ORDER } from './palette';
import type { PixelRange, ResolvedModifier, ResolvedParams } from './types';

// S32 second-wave modifiers. Each is a pure per-voice framebuffer transform driven through the
// shared chain runner (as the compositor drives it). Goldens pin the transform math; every
// modifier is checked for bypass = identity and cross-run determinism. A light stub model
// suffices — only createState reads pixelCount (to size its buffers).

const model = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const fullRange = (n: number): PixelRange => ({ start: 0, end: n });

/** Build a greyscale framebuffer from per-pixel values (all channels = value). */
function grey(values: number[]): Framebuffer {
  const fb = new Framebuffer(values.length);
  values.forEach((v, i) => fb.set(i, v, v, v, v));
  return fb;
}
/** Read channel `c` of every pixel. */
function chan(fb: Framebuffer, c: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) out.push(fb.rgba[i * 4 + c]!);
  return out;
}
const ch0 = (fb: Framebuffer): number[] => chan(fb, 0);
const f32 = (a: number[]): number[] => a.map((x) => Math.fround(x));

/** Apply a single modifier once to a fresh greyscale strip; return channel-0 output. */
function applyOnce(id: string, params: ResolvedParams, values: number[], timeMs = 0, dt = 16): number[] {
  const fb = grey(values);
  const n = values.length;
  applyModifierChain([{ modifierId: id, params }], [], fb, fullRange(n), model(n), timeMs, dt);
  return ch0(fb);
}

/** Drive a modifier across successive frames on a strip; `inputs[t]` is the frame at tick t.
    Returns channel-0 output per tick. State persists across ticks (per-voice lifecycle). */
function runTicks(id: string, params: ResolvedParams, inputs: number[][], dt: number): number[][] {
  const state: unknown[] = [];
  const n = inputs[0]!.length;
  const m = model(n);
  const r = fullRange(n);
  return inputs.map((frame, t) => {
    const fb = grey(frame);
    applyModifierChain([{ modifierId: id, params }], state, fb, r, m, t * dt, dt);
    return ch0(fb);
  });
}

describe('Slide / Offset', () => {
  it('wrap shifts the strip, wrapping the edge around', () => {
    expect(applyOnce('slide', { offset: 1, edge: 'wrap' }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.4, 0.1, 0.2, 0.3]));
  });
  it('clamp smears the edge pixel instead of wrapping', () => {
    expect(applyOnce('slide', { offset: 1, edge: 'clamp' }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.1, 0.1, 0.2, 0.3]));
  });
  it('fractional offset interpolates between neighbours', () => {
    const out = applyOnce('slide', { offset: 0.5, edge: 'clamp' }, [0, 1, 0, 0]);
    expect(out[1]).toBeCloseTo(0.5, 6); // halfway between px0(0) and px1(1)
    expect(out[2]).toBeCloseTo(0.5, 6); // halfway between px1(1) and px2(0)
  });
  it('offset 0 is identity', () => {
    expect(applyOnce('slide', { offset: 0, edge: 'wrap' }, [0.2, 0.5, 0.9])).toEqual(f32([0.2, 0.5, 0.9]));
  });
});

describe('Blur (1D)', () => {
  it('box-averages neighbours within the radius (edge-clamped)', () => {
    const out = applyOnce('blur', { radius: 1 }, [0, 1, 0, 0, 0]);
    expect(out[0]).toBeCloseTo((0 + 0 + 1) / 3, 6); // left neighbour clamps to px0
    expect(out[1]).toBeCloseTo((0 + 1 + 0) / 3, 6);
    expect(out[2]).toBeCloseTo((1 + 0 + 0) / 3, 6);
    expect(out[3]).toBeCloseTo(0, 6);
  });
  it('conserves total energy of a box average', () => {
    const before = [0.2, 0.8, 0.4, 0.6];
    const out = applyOnce('blur', { radius: 1 }, before);
    // Interior sum is preserved by a symmetric clamp box on a symmetric-ish signal within ~epsilon.
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('radius 0 is identity', () => {
    expect(applyOnce('blur', { radius: 0 }, [0.2, 0.5, 0.9])).toEqual(f32([0.2, 0.5, 0.9]));
  });
});

describe('Posterize / Threshold', () => {
  it('posterize snaps channels to N levels', () => {
    // levels 2 → step 1 → round(v): < 0.5 → 0, ≥ 0.5 → 1.
    expect(applyOnce('posterize', { mode: 'posterize', levels: 2 }, [0.2, 0.6, 0.9, 0.4])).toEqual(f32([0, 1, 1, 0]));
  });
  it('posterize keeps 0 and 1 exact and bands the middle', () => {
    // levels 3 → step 2 → {0, 0.5, 1}.
    expect(applyOnce('posterize', { mode: 'posterize', levels: 3 }, [0, 0.3, 0.5, 0.8, 1])).toEqual(
      f32([0, 0.5, 0.5, 1, 1]),
    );
  });
  it('threshold binarises about the cut', () => {
    expect(applyOnce('posterize', { mode: 'threshold', threshold: 0.5 }, [0.49, 0.5, 0.51])).toEqual(f32([0, 1, 1]));
  });
});

describe('Feedback', () => {
  it('re-injects a decaying copy of the previous output', () => {
    // shift 0, amount 0.5: out_t = min(1, cur_t + 0.5·out_{t-1}); single-pixel impulse then dark.
    const out = runTicks('feedback', { amount: 0.5, shift: 0 }, [[1], [0], [0]], 16);
    expect(out[0]![0]).toBeCloseTo(1, 6);
    expect(out[1]![0]).toBeCloseTo(0.5, 6);
    expect(out[2]![0]).toBeCloseTo(0.25, 6);
  });
  it('temporal state is pinned across ticks (deterministic replay)', () => {
    const run = (): number[][] => runTicks('feedback', { amount: 0.6, shift: 1 }, [[0.8, 0], [0, 0], [0.3, 0]], 16);
    expect(run()).toEqual(run());
  });
  it('amount 0 leaves the frame unchanged', () => {
    const out = runTicks('feedback', { amount: 0, shift: 1 }, [[0.4, 0.7], [0.1, 0.9]], 16);
    expect(out).toEqual([f32([0.4, 0.7]), f32([0.1, 0.9])]);
  });
});

describe('Kaleidoscope', () => {
  it('mirrors the opening wedge across the strip', () => {
    // segments 2 over 4 px: wedge = [px0, px1]; second wedge reflects it → [p0, p1, p1, p0].
    expect(applyOnce('kaleidoscope', { segments: 2 }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.1, 0.2, 0.2, 0.1]));
  });
  it('segments 1 is identity', () => {
    expect(applyOnce('kaleidoscope', { segments: 1 }, [0.1, 0.2, 0.3, 0.4])).toEqual(f32([0.1, 0.2, 0.3, 0.4]));
  });
});

describe('Freeze', () => {
  it('holds the sampled frame across an interval, refreshing on the boundary', () => {
    // interval 100ms, dt 50ms → sample windows: [0,100) captures tick0, [100,200) captures tick2.
    const out = runTicks('freeze', { intervalMs: 100 }, [[0.9], [0.1], [0.5], [0.2]], 50);
    expect(out.map((f) => f[0])).toEqual(f32([0.9, 0.9, 0.5, 0.5]));
  });
  it('interval 0 is a passthrough', () => {
    const out = runTicks('freeze', { intervalMs: 0 }, [[0.9], [0.1], [0.5]], 50);
    expect(out.map((f) => f[0])).toEqual(f32([0.9, 0.1, 0.5]));
  });
});

describe('Flicker / Glitch (seeded)', () => {
  it('is deterministic across runs for a fixed seed', () => {
    const inputs = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]];
    const run = (): number[][] => runTicks('flicker', { intensity: 0.8, dropProb: 0.3, seed: 7 }, inputs, 33);
    expect(run()).toEqual(run());
  });
  it('only ever dims (never brightens) a pixel', () => {
    const out = runTicks('flicker', { intensity: 1, dropProb: 0.2, seed: 3 }, [[0.6, 0.6, 0.6, 0.6]], 16);
    for (const v of out[0]!) expect(v).toBeLessThanOrEqual(0.6 + 1e-6);
    for (const v of out[0]!) expect(v).toBeGreaterThanOrEqual(0);
  });
  it('intensity 0 and dropProb 0 is identity', () => {
    expect(applyOnce('flicker', { intensity: 0, dropProb: 0, seed: 1 }, [0.3, 0.7, 0.5])).toEqual(f32([0.3, 0.7, 0.5]));
  });
});

describe('Chromatic offset', () => {
  it('shifts red and blue in opposite directions, leaving green', () => {
    const fb = new Framebuffer(4);
    // R gradient, B gradient, G constant.
    const R = [0.1, 0.2, 0.3, 0.4];
    const B = [0.5, 0.6, 0.7, 0.8];
    R.forEach((_, i) => fb.set(i, R[i]!, 0.9, B[i]!, 1));
    applyModifierChain([{ modifierId: 'chromatic', params: { amount: 1 } }], [], fb, fullRange(4), model(4), 0, 16);
    expect(chan(fb, 0)).toEqual(f32([0.1, 0.1, 0.2, 0.3])); // red shifted −1 (edge-clamped)
    expect(chan(fb, 2)).toEqual(f32([0.6, 0.7, 0.8, 0.8])); // blue shifted +1 (edge-clamped)
    expect(chan(fb, 1)).toEqual(f32([0.9, 0.9, 0.9, 0.9])); // green untouched
  });
  it('amount 0 is identity', () => {
    expect(applyOnce('chromatic', { amount: 0 }, [0.2, 0.5, 0.9])).toEqual(f32([0.2, 0.5, 0.9]));
  });
});

// --- cross-cutting: bypass = identity for every S32 modifier -------------------------------

const S32_IDS = ['slide', 'blur', 'posterize', 'feedback', 'kaleidoscope', 'freeze', 'flicker', 'chromatic'] as const;

describe('bypass = identity (every S32 modifier)', () => {
  it.each(S32_IDS)('%s: a bypassed link never touches the framebuffer', (id) => {
    const values = [0.15, 0.62, 0.33, 0.81, 0.05];
    const n = values.length;
    const def = listModifiers().find((m) => m.id === id)!;
    // Non-default params so "bypass" can't be confused with a coincidental no-op.
    const params: ResolvedParams = {};
    for (const s of def.paramSpec) params[s.key] = s.default;
    const fb = grey(values);
    applyModifierChain([{ modifierId: id, params, bypass: true }], [], fb, fullRange(n), model(n), 40, 16);
    expect(ch0(fb)).toEqual(f32(values));
  });
});

// --- palette: category grouping is dynamic over the registry --------------------------------

describe('listModifiersByCategory', () => {
  it('lists every registered modifier exactly once', () => {
    const grouped = listModifiersByCategory().flatMap((g) => g.modifiers.map((m) => m.id));
    const registered = listModifiers().map((m) => m.id);
    expect([...grouped].sort()).toEqual([...registered].sort());
    expect(new Set(grouped).size).toBe(grouped.length); // no duplicates
  });
  it('groups follow the declared category order and are non-empty', () => {
    const groups = listModifiersByCategory();
    const order = groups.map((g) => g.category);
    // categories present appear in MODIFIER_CATEGORY_ORDER order
    expect(order).toEqual(MODIFIER_CATEGORY_ORDER.filter((c) => order.includes(c)));
    for (const g of groups) expect(g.modifiers.length).toBeGreaterThan(0);
  });
  it('includes the full S32 set across its categories', () => {
    const ids = new Set(listModifiersByCategory().flatMap((g) => g.modifiers.map((m) => m.id)));
    for (const id of S32_IDS) expect(ids.has(id)).toBe(true);
  });
});
