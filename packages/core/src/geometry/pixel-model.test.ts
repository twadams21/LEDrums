import { describe, expect, it } from 'vitest';
import { drumHoopCount, parseKit } from './kit-schema';
import { buildPixelModel, materializeHoops } from './pixel-model';
import { buildDmxMap } from './dmx-map';

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

/* SF1 — a density-resolved drum (no literal `pixelsPerHoop`, no `hoops[]`) is the reachable shape
   whose C5 per-hoop write silently no-op'd. `materializeHoops` bakes its density-resolved counts
   into a first-class `hoops[]` so per-hoop editing works there, WITHOUT changing what the renderer
   builds — the counts it stamps are the SAME ones `buildPixelModel` already resolved. */
describe('materializeHoops (SF1) — lazy hoops[] for a density-resolved drum', () => {
  const densityKit = () => oneDrumKit(); // hoopCount 2, density 60, 12" → density-derived, NO hoops[]

  it('the reachable dead-control shape: a density drum carries no stored hoops[]', () => {
    expect(densityKit().drums[0]!.hoops).toBeUndefined();
  });

  it('materializes drumHoopCount hoops, each at the renderer-resolved pixelsPerHoop, reverse:false', () => {
    const kit = densityKit();
    const drum = kit.drums[0]!;
    const perHoop = buildPixelModel(kit).drums[0]!.pixelsPerHoop; // exactly what the renderer used
    const hoops = materializeHoops(kit, drum);
    expect(hoops).toHaveLength(drumHoopCount(kit, drum)); // 2
    expect(hoops).toEqual([
      { pixelCount: perHoop, reverse: false },
      { pixelCount: perHoop, reverse: false },
    ]);
  });

  it('is idempotent: a drum already carrying hoops[] returns them verbatim', () => {
    const kit = oneDrumKit({ hoops: [{ pixelCount: 8, reverse: true }, { pixelCount: 12, reverse: false }] });
    const drum = kit.drums[0]!;
    expect(materializeHoops(kit, drum)).toEqual(drum.hoops);
  });

  it('stamping the materialized hoops[] keeps the pixel model + DMX map BYTE-IDENTICAL', () => {
    const kit = densityKit();
    const before = buildPixelModel(kit);
    // What every write path does before an edit: materialize, then stamp onto the drum.
    const stamped = { ...kit, drums: [{ ...kit.drums[0]!, hoops: materializeHoops(kit, kit.drums[0]!) }] };
    const after = buildPixelModel(stamped);
    expect(after.pixelCount).toBe(before.pixelCount);
    expect(after.pixels).toEqual(before.pixels); // every pixel id / local / world / zone identical
    // DMX bytes identical too (flat derived map — no explicit outputs).
    expect(buildDmxMap(stamped, after)).toEqual(buildDmxMap(kit, before));
  });
});
