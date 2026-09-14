import { describe, expect, it } from 'vitest';
import { buildPixelModel, CURRENT_KIT_VERSION, eulerXYZApply, parseKit, type DrumConfig, type PixelModel, type Vec3 } from '@ledrums/core';
import { serializePixelModel, type SerializedDrum, type SerializedModel } from './index';

type Stage = NonNullable<SerializedDrum['stage']>;
type Vector = Stage['origin'];
type Mirror = 'none' | 'x' | 'y';

const origin = { x: 123, y: -456, z: 789 };
const rotation = { x: 31, y: -47, z: 63 };
const counts = [3, 8, 2, 5];

function kit(drum: Partial<DrumConfig> = {}, mirror: Mirror = 'none') {
  return parseKit({
    version: CURRENT_KIT_VERSION, // Fixture origin is already the body midpoint, not a legacy skin origin.
    global: { mirror },
    drums: [
      // Nonzero pixelStart catches an accidental model-global first/last sample.
      { id: 'lead', label: 'Legacy single hoop', color: '#abcdef', diameterIn: 8, hoopSpacingMm: 20,
        hoops: [{ pixelCount: 4 }], origin: { x: -200, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'body', label: 'Physical body', color: '#fedcba', diameterIn: 10, hoopSpacingMm: 37,
        hoops: counts.map((pixelCount) => ({ pixelCount })), origin, rotation, ...drum },
    ],
  });
}

/** The pre-Stage wire fields, read independently and without rounding/reordering any number. */
function legacyPayload(model: PixelModel): SerializedModel {
  return {
    count: model.pixelCount,
    positions: model.pixels.flatMap((p) => [p.world.x, p.world.y, p.world.z]),
    tangents: model.pixels.flatMap((p) => [p.tangent.x, p.tangent.y, p.tangent.z]),
    normals: model.pixels.flatMap((p) => [p.normal.x, p.normal.y, p.normal.z]),
    segmentLengths: model.pixels.map((p) => p.segmentLengthMm),
    drums: model.drums.map((d) => ({ id: d.drumId, label: d.label, color: d.color, pixelStart: d.pixelStart, pixelCount: d.pixelCount })),
    bounds: { center: [model.bounds.center.x, model.bounds.center.y, model.bounds.center.z], size: model.bounds.size },
  };
}

function expectLegacyUnchanged(model: PixelModel, serialized: SerializedModel) {
  const stripped = { ...serialized, drums: serialized.drums.map(({ stage, ...drum }) => drum) };
  expect(stripped).toStrictEqual(legacyPayload(model));
  expect(JSON.stringify(stripped)).toBe(JSON.stringify(legacyPayload(model)));
}

function reflected(v: Vec3, mirror: Mirror): Vector {
  return [mirror === 'x' ? -v.x : v.x, mirror === 'y' ? -v.y : v.y, v.z];
}

function expectVector(actual: Vector, expected: Vector) {
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 10));
}

function bodyStage(serialized: SerializedModel): Stage {
  const stage = serialized.drums[1]!.stage;
  expect(stage).toBeDefined();
  if (!stage) throw new Error('Expected physical body frame');
  return stage;
}

const transforms = (['none', 'x', 'y'] as const).flatMap((mirror) =>
  [false, true].flatMap((flip) => [false, true].map((reverse) => ({ mirror, flip, reverse }))),
);

describe('serializePixelModel', () => {
  it('preserves every old field exactly and leaves the source model untouched', () => {
    const model = buildPixelModel(kit({ startAngleDeg: 17, localSpinDeg: -9, flip: true }, 'x'));
    const before = structuredClone(model);
    const serialized = serializePixelModel(model);
    expectLegacyUnchanged(model, serialized);
    expect(model).toStrictEqual(before);
    expect(serializePixelModel(model)).toStrictEqual(serialized);
    expect(bodyStage(serialized).hoopPixelCounts).not.toBe(model.drums[1]!.hoopPixelCounts);
    bodyStage(serialized).hoopPixelCounts[0] = 999;
    serialized.positions[0] = 999;
    serialized.bounds.center[0] = 999;
    expect(model).toStrictEqual(before);
  });

  it('uses world mm and physical drum-local XYZ, without a glTF Y-up/metres conversion', () => {
    const model = buildPixelModel(kit({ rotation: { x: 90, y: 0, z: 90 }, startAngleDeg: 43 }));
    const stage = bodyStage(serializePixelModel(model));
    expectVector(stage.origin, [123, -456, 789]);
    expectVector(stage.xAxis, [0, 0, 1]);
    expectVector(stage.yAxis, [-1, 0, 0]);
    expectVector(stage.zAxis, [0, -1, 0]);
    expect(stage.radiusMm).toBe(127);
    expect(stage.hoopSpacingMm).toBeCloseTo(37, 10);
  });

  it.each(transforms)('keeps body axes phase-independent: mirror=$mirror flip=$flip reverse=$reverse', ({ mirror, flip, reverse }) => {
    const expectedX = reflected(eulerXYZApply({ x: 1, y: 0, z: 0 }, rotation), mirror);
    const expectedY = reflected(eulerXYZApply({ x: 0, y: flip ? -1 : 1, z: 0 }, rotation), mirror);
    const expectedZ = reflected(eulerXYZApply({ x: 0, y: 0, z: flip ? -1 : 1 }, rotation), mirror);
    let previous: SerializedModel | undefined;
    // Change start angle and local spin independently, including wrapped/negative phases.
    for (const [startAngleDeg, localSpinDeg] of [[0, 0], [37, 0], [0, -83], [811, -725]]) {
      const model = buildPixelModel(kit({
        flip, startAngleDeg, localSpinDeg,
        hoops: counts.map((pixelCount, i) => ({ pixelCount, reverse: i % 2 === 0 ? reverse : !reverse })),
      }, mirror));
      const serialized = serializePixelModel(model);
      const stage = bodyStage(serialized);
      expectVector(stage.origin, reflected(origin, mirror));
      expectVector(stage.xAxis, expectedX);
      expectVector(stage.yAxis, expectedY);
      expectVector(stage.zAxis, expectedZ);
      for (const axis of [stage.xAxis, stage.yAxis, stage.zAxis]) expect(Math.hypot(...axis)).toBeCloseTo(1, 12);
      expect(stage.radiusMm).toBe(127);
      expect(stage.hoopSpacingMm).toBeCloseTo(37, 10);
      expect(stage.hoopPixelCounts).toEqual(counts);
      expectLegacyUnchanged(model, serialized);
      // The phase really changes the LEDs, even though the physical frame stays fixed.
      if (previous) expect(serialized.positions).not.toEqual(previous.positions);
      previous = serialized;
    }
  });

  it('locates first/last hoop centres by prefix counts, not pixelsPerHoop or the effect origin', () => {
    const model = buildPixelModel(kit({ flip: true, startAngleDeg: 59 }, 'y'));
    model.drums[1]!.pixelsPerHoop = 999; // Explicitly poison the lossy uniform-count field.
    const stage = bodyStage(serializePixelModel(model));
    expect(stage.hoopPixelCounts).toEqual([3, 8, 2, 5]);
    expectVector(stage.origin, reflected(origin, 'y'));
    expect(stage.hoopSpacingMm).toBeCloseTo(37, 10);
    const drum = model.drums[1]!;
    const starts = [drum.pixelStart, drum.pixelStart + 3 + 8 + 2];
    for (let i = 0; i < starts.length; i++) {
      const p = model.pixels[starts[i]!]!;
      const halfSpan = (counts.length - 1) * stage.hoopSpacingMm / 2;
      const sign = i === 0 ? -1 : 1;
      expectVector([
        p.world.x - p.normal.x * stage.radiusMm,
        p.world.y - p.normal.y * stage.radiusMm,
        p.world.z - p.normal.z * stage.radiusMm,
      ], [
        stage.origin[0] + sign * halfSpan * stage.zAxis[0],
        stage.origin[1] + sign * halfSpan * stage.zAxis[1],
        stage.origin[2] + sign * halfSpan * stage.zAxis[2],
      ]);
    }
    expect(stage.origin).not.toEqual([drum.effectOriginWorld.x, drum.effectOriginWorld.y, drum.effectOriginWorld.z]);
  });

  it('supports a positive two-hoop stack with one pixel per hoop', () => {
    const model = buildPixelModel(kit({ hoops: [{ pixelCount: 1, reverse: false }, { pixelCount: 1, reverse: true }] }));
    const stage = bodyStage(serializePixelModel(model));
    expectVector(stage.origin, reflected(origin, 'none'));
    expect(stage.hoopPixelCounts).toEqual([1, 1]);
    expect(stage.hoopSpacingMm).toBeCloseTo(37, 10);
  });

  it('omits stage entirely for single-hoop legacy geometry and an empty model', () => {
    const model = buildPixelModel(kit({ hoops: [{ pixelCount: 7, reverse: true }], flip: true }));
    const serialized = serializePixelModel(model);
    for (const drum of serialized.drums) expect(drum).not.toHaveProperty('stage');
    expectLegacyUnchanged(model, serialized);
    const empty: PixelModel = { ...model, pixels: [], drums: [], drumById: new Map(), pixelCount: 0 };
    expect(serializePixelModel(empty)).toStrictEqual(legacyPayload(empty));
  });

  const unsupported: Array<[string, (model: PixelModel) => void]> = [
    ['no hoop counts', (m) => { m.drums[1]!.hoopPixelCounts = []; }],
    ['mismatched hoop count', (m) => { m.drums[1]!.hoopCount = 3; }],
    ['mismatched total count', (m) => { m.drums[1]!.hoopPixelCounts[0] = 4; }],
    ['empty hoop', (m) => { m.drums[1]!.hoopPixelCounts[0] = 0; }],
    ['fractional count', (m) => { m.drums[1]!.hoopPixelCounts[0] = 1.5; }],
    ['zero radius', (m) => { m.drums[1]!.radiusMm = 0; }],
    ['infinite radius', (m) => { m.drums[1]!.radiusMm = Infinity; }],
    ['invalid angle', (m) => { m.pixels[4]!.angleDeg = NaN; }],
    ['invalid local Z', (m) => { m.pixels[4]!.local.z = NaN; }],
    ['invalid normal', (m) => { m.pixels[4]!.normal = { x: 0, y: 0, z: 0 }; }],
    ['parallel normal/tangent', (m) => { m.pixels[4]!.tangent = { ...m.pixels[4]!.normal }; }],
    ['invalid last centre', (m) => { m.pixels[17]!.world.z = NaN; }],
    ['no local span', (m) => { m.pixels[17]!.local.z = m.pixels[4]!.local.z; }],
    ['no world span', (m) => {
      // In the unrotated/unphased fixture, first and last radial offsets are identical.
      m.pixels[17]!.world = { ...m.pixels[4]!.world };
    }],
    ['non-axial span', (m) => { m.pixels[17]!.world.x += 100; }],
  ];
  it.each(unsupported)('falls back to untouched Pixels for %s', (_reason, damage) => {
    const model = buildPixelModel(kit({ rotation: { x: 0, y: 0, z: 0 } }));
    damage(model);
    const serialized = serializePixelModel(model);
    expect(serialized.drums[1]).not.toHaveProperty('stage');
    expectLegacyUnchanged(model, serialized);
  });
});
