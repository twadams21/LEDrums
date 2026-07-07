import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from './chain';
import { buildSliceMapping, type SliceState } from './impl/slice';
import { listModifiers } from './registry';
import type { PixelRange, ResolvedModifier, ResolvedParams } from './types';

const model = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const range = (start: number, end: number): PixelRange => ({ start, end });
const link = (params: ResolvedParams): ResolvedModifier => ({ modifierId: 'slice', params });

function strip(values: number[]): Framebuffer {
  const fb = new Framebuffer(values.length);
  values.forEach((v, i) => fb.set(i, v, v + 0.01, v + 0.02, v + 0.03));
  return fb;
}

function channels(fb: Framebuffer, c: number): number[] {
  return [...Array(fb.pixelCount)].map((_, i) => fb.rgba[i * 4 + c]!);
}

function apply(params: ResolvedParams, values: number[], state: unknown[] = [], r = range(0, values.length)): Framebuffer {
  const fb = strip(values);
  applyModifierChain([link(params)], state, fb, r, model(values.length), 0, 16);
  return fb;
}

describe('Slice modifier', () => {
  it('is registered as a spatial modifier so Modify palettes discover it', () => {
    const def = listModifiers().find((m) => m.id === 'slice');
    expect(def?.name).toBe('Slice');
    expect(def?.category).toBe('spatial');
    expect(def?.paramSpec.find((p) => p.key === 'width')?.unit).toBe('px');
  });

  it('constructs deterministic pixel-width bands', () => {
    const a = buildSliceMapping(12, 4, 0, 9);
    const b = buildSliceMapping(12, 4, 0, 9);
    expect(a.bands).toEqual([
      { start: 0, width: 4 },
      { start: 4, width: 4 },
      { start: 8, width: 4 },
    ]);
    expect([...a.sourceByLocal]).toEqual([...b.sourceByLocal]);
    expect([...a.sourceByLocal].sort((x, y) => x - y)).toEqual([...Array(12)].map((_, i) => i));
  });

  it('keeps jittered band widths inside the requested spread bounds', () => {
    const width = 10;
    const jitter = 0.3;
    const { bands } = buildSliceMapping(97, width, jitter, 5);
    const min = width - Math.floor(width * jitter);
    const max = width + Math.floor(width * jitter);
    for (const band of bands.slice(0, -1)) {
      expect(band.width).toBeGreaterThanOrEqual(min);
      expect(band.width).toBeLessThanOrEqual(max);
    }
    expect(bands.reduce((sum, b) => sum + b.width, 0)).toBe(97);
  });

  it('remaps pixels spatially without changing their channel values', () => {
    const values = [...Array(16)].map((_, i) => i / 16);
    const fb = apply({ width: 4, jitter: 0, seed: 2 }, values);
    const red = channels(fb, 0);
    expect(red).not.toEqual(values.map(Math.fround));
    expect([...red].sort((a, b) => a - b)).toEqual(values.map(Math.fround));
    const green = channels(fb, 1);
    for (let i = 0; i < fb.pixelCount; i++) expect(green[i]! - red[i]!).toBeCloseTo(0.01, 6);
  });

  it('keeps the shuffled order stable across frames for one voice state', () => {
    const state: unknown[] = [];
    const params = { width: 3, jitter: 0.5, seed: 42 };
    const first = channels(apply(params, [...Array(19)].map((_, i) => i), state), 0);
    const second = channels(apply(params, [...Array(19)].map((_, i) => i), state), 0);
    expect(second).toEqual(first);
  });

  it('rebuilds modifier state when params or target range materially change', () => {
    const state: unknown[] = [];
    apply({ width: 4, jitter: 0, seed: 1 }, [...Array(20)].map((_, i) => i), state, range(0, 20));
    const s1 = state[0] as SliceState;
    const sig1 = s1.signature;
    const map1 = s1.sourceByLocal;

    apply({ width: 5, jitter: 0, seed: 1 }, [...Array(20)].map((_, i) => i), state, range(0, 20));
    const s2 = state[0] as SliceState;
    expect(s2.signature).not.toBe(sig1);
    expect(s2.sourceByLocal).not.toBe(map1);

    const sig2 = s2.signature;
    apply({ width: 5, jitter: 0, seed: 1 }, [...Array(20)].map((_, i) => i), state, range(2, 18));
    const s3 = state[0] as SliceState;
    expect(s3.signature).not.toBe(sig2);
    expect(s3.sourceByLocal.length).toBe(16);
  });
});
