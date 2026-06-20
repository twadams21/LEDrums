import { describe, expect, it } from 'vitest';
import { blendChannel, compositeInto } from './blend';

describe('blendChannel', () => {
  it('add clamps to 1.0', () => {
    expect(blendChannel('add', 0.6, 0.6)).toBe(1);
  });
  it('multiply', () => {
    expect(blendChannel('multiply', 1, 0.5)).toBe(0.5);
  });
  it('screen is >= both inputs', () => {
    const r = blendChannel('screen', 0.4, 0.5);
    expect(r).toBeGreaterThanOrEqual(0.5);
  });
  it('lighten / max takes the brighter', () => {
    expect(blendChannel('lighten', 0.3, 0.7)).toBe(0.7);
    expect(blendChannel('max', 0.9, 0.7)).toBe(0.9);
  });
});

describe('compositeInto', () => {
  function fb(r: number, g: number, b: number, a = 0): Float32Array {
    return new Float32Array([r, g, b, a]);
  }

  it('opacity 0 leaves dest unchanged', () => {
    const d = fb(0.2, 0.3, 0.4);
    compositeInto(d, 0, 1, 1, 1, 1, 'normal', 0);
    expect(d[0]).toBeCloseTo(0.2, 6);
    expect(d[1]).toBeCloseTo(0.3, 6);
    expect(d[2]).toBeCloseTo(0.4, 6);
  });

  it('normal opacity 1 replaces with source', () => {
    const d = fb(0.2, 0.3, 0.4);
    compositeInto(d, 0, 0.7, 0.6, 0.5, 1, 'normal', 1);
    expect(d[0]).toBeCloseTo(0.7, 6);
    expect(d[1]).toBeCloseTo(0.6, 6);
    expect(d[2]).toBeCloseTo(0.5, 6);
  });

  it('add brightens', () => {
    const d = fb(0.3, 0.3, 0.3);
    compositeInto(d, 0, 0.4, 0.4, 0.4, 1, 'add', 1);
    expect(d[0]).toBeCloseTo(0.7, 6);
  });

  it('accumulates coverage in the alpha channel', () => {
    const d = fb(0, 0, 0, 0);
    compositeInto(d, 0, 1, 1, 1, 1, 'normal', 0.5);
    expect(d[3]).toBeCloseTo(0.5, 6);
  });
});
