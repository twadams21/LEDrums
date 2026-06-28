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

  it('hoop-0 pixels lie on a circle of the drum radius in local space', () => {
    const model = buildPixelModel(oneDrumKit());
    const radius = (12 * 25.4) / 2;
    for (const p of model.pixels.filter((px) => px.hoopIndex === 0)) {
      const r = Math.hypot(p.local.x, p.local.y);
      expect(r).toBeCloseTo(radius, 6);
      expect(p.local.z).toBe(0);
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

  it('assigns one zone per pixel and stacks hoops along local +Z', () => {
    const model = buildPixelModel(oneDrumKit());
    expect(model.pixels.every((p) => ['center', 'edge', 'rim', 'shell'].includes(p.zone))).toBe(true);
    const hoop1 = model.pixels.find((p) => p.hoopIndex === 1)!;
    expect(hoop1.local.z).toBe(50);
  });
});
