import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { buildPixelModel, type PixelModel } from './pixel-model';
import { buildPixelGrid, forEachPixelWithin, nearestPixelWithin } from './pixel-grid';
import { distance, mulberry32, type Vec3 } from '../math';

function model(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        {
          id: 'kick',
          diameterIn: 22,
          hoopSpacingMm: 50,
          origin: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        {
          id: 'snare',
          diameterIn: 14,
          hoopSpacingMm: 50,
          origin: { x: 600, y: 200, z: 150 },
          rotation: { x: 0.3, y: 0, z: 0.1 },
        },
        {
          id: 'tom1',
          diameterIn: 10,
          hoopSpacingMm: 50,
          origin: { x: 300, y: 500, z: 400 },
          rotation: { x: 0, y: 0.4, z: 0 },
        },
      ],
    }),
  );
}

/** Brute-force reference: the exact scan the effects used before the grid. */
function bruteNearest(m: PixelModel, point: Vec3): { id: number; dist: number } {
  let bestId = -1;
  let bestDist = Infinity;
  for (const px of m.pixels) {
    const d = distance(px.world, point);
    if (d < bestDist) {
      bestDist = d;
      bestId = px.id;
    }
  }
  return { id: bestId, dist: bestDist };
}

function bruteWithin(m: PixelModel, point: Vec3, radius: number): Set<number> {
  const ids = new Set<number>();
  for (const px of m.pixels) {
    if (distance(px.world, point) <= radius) ids.add(px.id);
  }
  return ids;
}

function randomPoints(m: PixelModel, n: number): Vec3[] {
  const rng = mulberry32(0x9e37);
  const { min, max } = m.bounds;
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    // Sample inside AND well outside the bounds so out-of-reach paths are exercised.
    const pad = m.bounds.size * 0.5;
    pts.push({
      x: min.x - pad + rng() * (max.x - min.x + 2 * pad),
      y: min.y - pad + rng() * (max.y - min.y + 2 * pad),
      z: min.z - pad + rng() * (max.z - min.z + 2 * pad),
    });
  }
  return pts;
}

describe('pixel-grid', () => {
  const m = model();
  const grid = buildPixelGrid(m);

  it('nearestPixelWithin matches the brute-force nearest scan (confetti equivalence)', () => {
    const reach = Math.max(40, m.bounds.size * 0.08);
    for (const pt of randomPoints(m, 200)) {
      const brute = bruteNearest(m, pt);
      const hit = nearestPixelWithin(grid, pt, reach);
      if (brute.dist > reach) {
        expect(hit).toBeNull();
      } else {
        expect(hit).not.toBeNull();
        expect(hit!.id).toBe(brute.id);
        expect(hit!.dist).toBeCloseTo(brute.dist, 10);
      }
    }
  });

  it('forEachPixelWithin visits exactly the brute-force radius set (lightning equivalence)', () => {
    for (const radius of [60, 120, 600]) {
      for (const pt of randomPoints(m, 60)) {
        const expected = bruteWithin(m, pt, radius);
        const got = new Set<number>();
        forEachPixelWithin(grid, pt, radius, (id, d) => {
          expect(d).toBeCloseTo(distance(m.pixels[id]!.world, pt), 10);
          expect(got.has(id)).toBe(false); // each pixel visited once
          got.add(id);
        });
        expect(got).toEqual(expected);
      }
    }
  });

  it('is exact at the radius boundary (inclusive, like the old `d > r` skip)', () => {
    const px = m.pixels[0]!;
    const probe = { x: px.world.x + 50, y: px.world.y, z: px.world.z };
    const d = distance(px.world, probe);
    const seen: number[] = [];
    forEachPixelWithin(grid, probe, d, (id) => seen.push(id));
    expect(seen).toContain(px.id);
  });

  it('handles an empty model', () => {
    const zero = { x: 0, y: 0, z: 0 };
    const empty: PixelModel = {
      pixels: [],
      drums: [],
      drumById: new Map(),
      bounds: { min: zero, max: { ...zero }, center: { ...zero }, size: 0 },
      pixelCount: 0,
    };
    const g = buildPixelGrid(empty);
    expect(nearestPixelWithin(g, { x: 0, y: 0, z: 0 }, 100)).toBeNull();
    forEachPixelWithin(g, { x: 0, y: 0, z: 0 }, 100, () => {
      throw new Error('should not visit');
    });
  });
});
