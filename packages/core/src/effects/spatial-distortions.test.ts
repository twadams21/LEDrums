import { describe, expect, it } from 'vitest';
import { spatialRipple, spatialSwirl, spatialWaveShell } from './spatial-distortions';

for (const [name, distort] of [['swirl', spatialSwirl], ['ripple', spatialRipple]] as const) {
  describe(`bounded spatial ${name}`, () => {
    it('identity at zero; finite and displacement-bounded across axes, origin and far points', () => {
      const out = { x: 0, y: 0, z: 0 };
      for (const point of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 2, -3], [1e5, -2e5, 3e5]]) {
        const [x, y, z] = point as [number, number, number];
        distort(x, y, z, 0, 6, 1.7, out);
        expect(out.x).toBeCloseTo(x, 10);
        expect(out.y).toBeCloseTo(y, 10);
        expect(out.z).toBeCloseTo(z, 10);
        for (const amount of [-1, -0.2, 0.4, 1]) for (const phase of [-100, 0, 1, 100]) {
          distort(x, y, z, amount, 6, phase, out);
          expect(Object.values(out).every(Number.isFinite)).toBe(true);
          expect(Math.hypot(out.x - x, out.y - y, out.z - z)).toBeLessThanOrEqual(Math.abs(amount) + 1e-9);
        }
      }
    });

    it('changes a point reproducibly with phase and frequency, without retaining the output carrier', () => {
      const out = { x: 0, y: 0, z: 0 };
      distort(0.2, -0.6, 0.4, 0.8, 3, 0.5, out);
      const expected = { ...out };
      distort(0.2, -0.6, 0.4, 0.8, 6, 0.5, out);
      expect(out).not.toEqual(expected);
      distort(0.2, -0.6, 0.4, 0.8, 3, 1.5, out);
      expect(out).not.toEqual(expected);
      distort(0.2, -0.6, 0.4, 0.8, 3, 0.5, out);
      expect(out).toEqual(expected);
    });
  });
}

it('swirl preserves cylindrical radius and height', () => {
  const out = { x: 0, y: 0, z: 0 };
  spatialSwirl(0.3, -0.7, 0.5, 1, 4, 0.8, out);
  expect(Math.hypot(out.x, out.y)).toBeCloseTo(Math.hypot(0.3, -0.7), 14);
  expect(out.z).toBe(0.5);
});

it('ripple stays radially aligned and tends continuously to zero displacement at the centre', () => {
  const out = { x: 0, y: 0, z: 0 };
  spatialRipple(0.3, -0.6, 0.9, 1, 5, 1.2, out);
  expect(out.y / out.x).toBeCloseTo(-2, 14);
  expect(out.z / out.x).toBeCloseTo(3, 14);
  spatialRipple(1e-12, 0, 0, 1, 5, Math.PI / 2, out);
  expect(Math.abs(out.x)).toBeLessThan(2e-12);
});

it('hit shell has compact support and unchanged squared-quadratic profile', () => {
  expect(spatialWaveShell(100, 100, 20)).toBe(1);
  expect(spatialWaveShell(80, 100, 20)).toBe(0);
  expect(spatialWaveShell(120, 100, 20)).toBe(0);
  expect(spatialWaveShell(70, 100, 20)).toBe(0);
  expect(spatialWaveShell(130, 100, 20)).toBe(0);
  expect(spatialWaveShell(110, 100, 20)).toBe(0.5625);
  expect(spatialWaveShell(90, 100, 20)).toBe(0.5625);
});
