import { describe, expect, it } from 'vitest';
import type { KitConfig } from '@ledrums/core';
import { drumPixelTotal, hoopIndices, pixelsForHoopIn } from './drums-hoops';

const kit = (drumOverrides: Partial<KitConfig['drums'][number]> = {}): KitConfig => ({
  version: 1,
  units: 'mm',
  global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 304, mirror: 'none', expanded: false },
  drums: [
    {
      id: 'kick',
      label: 'Kick',
      color: '#fff',
      diameterIn: 22,
      hoopSpacingMm: 50,
      localSpinDeg: 0,
      startAngleDeg: 0,
      origin: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      ...drumOverrides,
    },
  ],
  outputs: [],
});

describe('hoopIndices', () => {
  it('uses hoops[] length when present (first-class hoops win)', () => {
    const k = kit({ hoops: [{ pixelCount: 10, reverse: false }, { pixelCount: 20, reverse: false }], hoopCount: 5 });
    expect(hoopIndices(k.drums[0]!, k)).toEqual([1, 2]);
  });

  it('falls back to the per-drum hoopCount override', () => {
    const k = kit({ hoopCount: 3 });
    expect(hoopIndices(k.drums[0]!, k)).toEqual([1, 2, 3]);
  });

  it('falls back to the kit global count', () => {
    const k = kit();
    expect(hoopIndices(k.drums[0]!, k)).toEqual([1, 2, 3, 4]);
  });
});

describe('drumPixelTotal', () => {
  it('sums mixed per-hoop counts', () => {
    const k = kit({ hoops: [{ pixelCount: 10, reverse: false }, { pixelCount: 25, reverse: true }] });
    expect(drumPixelTotal(k.drums[0]!, k)).toBe(35);
  });

  it('sums the uniform legacy count across every hoop', () => {
    const k = kit({ pixelsPerHoop: 30 }); // 4 hoops (kit global) × 30
    expect(drumPixelTotal(k.drums[0]!, k)).toBe(120);
  });
});

describe('pixelsForHoopIn', () => {
  it('resolves a routed hoop ref to its literal per-hoop count', () => {
    const k = kit({ hoops: [{ pixelCount: 10, reverse: false }, { pixelCount: 25, reverse: false }] });
    const px = pixelsForHoopIn(k);
    expect(px({ drumId: 'kick', hoop: 1 })).toBe(10);
    expect(px({ drumId: 'kick', hoop: 2 })).toBe(25);
  });

  it('returns 0 for a ref to a drum the kit does not have', () => {
    expect(pixelsForHoopIn(kit())({ drumId: 'ghost', hoop: 1 })).toBe(0);
  });
});
