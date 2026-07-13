import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { buildPixelModel } from './pixel-model';

function oneDrumKit(overrides: Record<string, unknown> = {}) {
  return parseKit({
    global: { ledDensityPxPerM: 60, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      {
        id: 'kick',
        diameterIn: 12,
        hoopSpacingMm: 50,
        localSpinDeg: 0,
        startAngleDeg: 0,
        origin: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        ...overrides,
      },
    ],
  });
}

describe('buildPixelModel', () => {
  it('emits hoopCount × pixelsPerHoop pixels matching round(pi*d_m*density)*hoops', () => {
    const kit = oneDrumKit();
    const model = buildPixelModel(kit);
    const diameterM = (12 * 25.4) / 1000;
    const perHoop = Math.round(Math.PI * diameterM * 60);
    expect(model.drums[0]!.pixelsPerHoop).toBe(perHoop);
    expect(model.pixelCount).toBe(perHoop * 2);
    expect(model.pixels).toHaveLength(perHoop * 2);
  });

  it('honors a literal pixelsPerHoop, ignoring density entirely', () => {
    // Density 60 on a 12" drum would compute ~57 px/hoop; the literal must win.
    const model = buildPixelModel(oneDrumKit({ pixelsPerHoop: 50 }));
    const diameterM = (12 * 25.4) / 1000;
    const densityPerHoop = Math.round(Math.PI * diameterM * 60);
    expect(densityPerHoop).not.toBe(50);
    expect(model.drums[0]!.pixelsPerHoop).toBe(50);
    expect(model.pixelCount).toBe(50 * 2); // hoopCount 2
  });

  it('first-hoop pixels lie on a circle of the drum radius, at the centred stack base (B3)', () => {
    const model = buildPixelModel(oneDrumKit());
    const radius = (12 * 25.4) / 2;
    // hoopCount 2 × 50mm spacing → halfStack 25mm; the first hoop (1-based, A1) sits at -25mm.
    const firstHoop = model.pixels.filter((px) => px.hoopIndex === 1);
    expect(firstHoop.length).toBeGreaterThan(0);
    for (const p of firstHoop) {
      const r = Math.hypot(p.local.x, p.local.y);
      expect(r).toBeCloseTo(radius, 6);
      expect(p.local.z).toBe(-25);
    }
  });

  it('translates world by origin', () => {
    const model = buildPixelModel(oneDrumKit({ origin: { x: 100, y: 0, z: 0 } }));
    const radius = (12 * 25.4) / 2;
    const p0 = model.pixels[0]!;
    // first pixel: angle 0 -> local (radius, 0, 0); world.x shifted by +100
    expect(p0.world.x).toBeCloseTo(radius + 100, 6);
  });

  it('first pixel angle equals startAngle + localSpin (mod 360)', () => {
    const model = buildPixelModel(oneDrumKit({ startAngleDeg: 30, localSpinDeg: 15 }));
    expect(model.pixels[0]!.angleDeg).toBeCloseTo(45, 6);
  });

  it('angles increase by 360 / pixelsPerHoop within a hoop', () => {
    const model = buildPixelModel(oneDrumKit());
    const perHoop = model.drums[0]!.pixelsPerHoop;
    const step = 360 / perHoop;
    expect(model.pixels[1]!.angleDeg).toBeCloseTo(step, 6);
  });

  it('assigns one zone per pixel and stacks hoops along local +Z (centred on origin, B3)', () => {
    const model = buildPixelModel(oneDrumKit());
    expect(model.pixels.every((p) => ['center', 'edge', 'rim', 'shell'].includes(p.zone))).toBe(true);
    const hoop2 = model.pixels.find((p) => p.hoopIndex === 2)!; // hoop 2 = second hoop (1-based, A1)
    // Centred stack (halfStack 25mm): hoop 1 at -25mm, hoop 2 at +25mm — 50mm above hoop 1.
    expect(hoop2.local.z).toBe(25);
  });
});
