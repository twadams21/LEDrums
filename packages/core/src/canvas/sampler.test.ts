import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { buildSamplerTable, isWorldSpaceSampler, uvFor } from './sampler';

/** 2 drums × 2 hoops, 8px/hoop → 32 pixels, drums 600mm apart on x. */
function model(drumCount = 2, hoopCount = 2): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: Array.from({ length: drumCount }, (_, i) => ({
        id: `d${i}`,
        diameterIn: 8,
        pixelsPerHoop: 8,
        hoopSpacingMm: 50,
        origin: { x: i * 600, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      })),
    }),
  );
}

describe('buildSamplerTable — the four placements (D4)', () => {
  it('hoop: every pixel of a hoop lies on that hoop\'s canvas circle at its own angle', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'hoop' });
    // 4 hoops → 2×2 auto grid, cell 0.5×0.5, r = 0.4·0.5 = 0.2; hoop 0 centred (0.25, 0.25)
    for (let i = 0; i < 8; i++) {
      const p = m.pixels[i]!;
      const d = Math.hypot(t.u[i]! - 0.25, t.v[i]! - 0.25);
      expect(d).toBeCloseTo(0.2, 5);
      // angular placement follows the pixel's own hoop angle
      const a = (p.angleDeg * Math.PI) / 180;
      expect(t.u[i]!).toBeCloseTo(0.25 + 0.2 * Math.cos(a), 5);
      expect(t.v[i]!).toBeCloseTo(0.25 + 0.2 * Math.sin(a), 5);
    }
    // second drum's hoops land in later grid cells (distinct centres)
    const d1FirstHoop = m.drums[1]!.pixelStart;
    const d = Math.hypot(t.u[d1FirstHoop]! - 0.25, t.v[d1FirstHoop]! - 0.25);
    expect(d).toBeGreaterThan(0.2 + 1e-3); // not on hoop 0's circle
  });

  it('hoop: explicit placements override the auto grid per global hoop index', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'hoop', placements: [{ cx: 0.5, cy: 0.5, r: 0.1 }] });
    // hoop 0 uses the placement…
    expect(Math.hypot(t.u[0]! - 0.5, t.v[0]! - 0.5)).toBeCloseTo(0.1, 5);
    // …hoop 1 (no placement entry) falls back to its auto-grid cell (0.75, 0.25)
    const h1 = 8; // pixels 8..15 are drum 0 hoop 1
    expect(Math.hypot(t.u[h1]! - 0.75, t.v[h1]! - 0.25)).toBeCloseTo(0.2, 5);
  });

  it('strip: the chain unwinds to a centred line, monotonic in build order, span + offset respected', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'strip', angleDeg: 0, span: 0.8, offset: 0.1 });
    // along +u, first pixel at 0.5 - 0.4, last at 0.5 + 0.4; v = 0.5 + offset
    expect(t.u[0]!).toBeCloseTo(0.1, 5);
    expect(t.u[m.pixelCount - 1]!).toBeCloseTo(0.9, 5);
    for (let i = 1; i < m.pixelCount; i++) {
      expect(t.u[i]!).toBeGreaterThan(t.u[i - 1]!);
      expect(t.v[i]!).toBeCloseTo(0.6, 5);
    }
  });

  it('strip: angleDeg 90 unwinds along v', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'strip', angleDeg: 90 });
    expect(t.v[0]!).toBeCloseTo(0, 5);
    expect(t.v[m.pixelCount - 1]!).toBeCloseTo(1, 5);
    expect(t.u[0]!).toBeCloseTo(0.5, 5);
  });

  it('cylinder: maps Pixel.uv into the destination region', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'cylinder', region: { u0: 0.25, v0: 0.5, u1: 0.75, v1: 1 } });
    for (let i = 0; i < m.pixelCount; i++) {
      const p = m.pixels[i]!;
      expect(t.u[i]!).toBeCloseTo(0.25 + p.uv.u * 0.5, 5);
      expect(t.v[i]!).toBeCloseTo(0.5 + p.uv.v * 0.5, 5);
    }
  });

  it('footprint: identical to the legacy planar-xz projection', () => {
    const m = model();
    const t = buildSamplerTable(m, { kind: 'footprint' });
    for (let i = 0; i < m.pixelCount; i++) {
      const [u, v] = uvFor(i, m, 'planar-xz');
      expect(t.u[i]!).toBeCloseTo(u, 6);
      expect(t.v[i]!).toBeCloseTo(v, 6);
    }
  });

  it('world-space samplers are cylinder + footprint (hyper4d domain)', () => {
    expect(isWorldSpaceSampler({ kind: 'cylinder' })).toBe(true);
    expect(isWorldSpaceSampler({ kind: 'footprint' })).toBe(true);
    expect(isWorldSpaceSampler({ kind: 'hoop' })).toBe(false);
    expect(isWorldSpaceSampler({ kind: 'strip' })).toBe(false);
  });
});
