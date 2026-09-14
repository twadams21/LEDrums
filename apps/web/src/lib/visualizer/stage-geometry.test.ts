import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT } from '@ledrums/core';
import { Vector3 } from 'three';
import { buildStageLayout, MAX_STAGE_DRUMS, sceneVector } from './stage-geometry';
import { kitModel, emptyModel } from './testing/model';

describe('stage geometry reconstructed from real core pixels', () => {
  it.each(['none', 'x', 'y'] as const)('recovers rotated, translated, flipped and mixed-density drums under mirror %s', (mirror) => {
    const kit = {
      ...DEFAULT_KIT, global: { ...DEFAULT_KIT.global, mirror },
      drums: DEFAULT_KIT.drums.map((d, i) => ({
        ...d, origin: { x: 870 + i * 430, y: -940 + i * 65, z: 1200 + i * 240 },
        rotation: { x: 35 + i * 17, y: -23 + i * 11, z: 47 - i * 6 }, flip: i % 2 === 0,
        hoops: [3, 19, 7, 11].map((pixelCount, h) => ({ pixelCount, reverse: h % 2 === 0 })),
      })),
    };
    const model = kitModel(kit);
    const layout = buildStageLayout(model);
    expect(layout.drums).toHaveLength(kit.drums.length);
    for (const [i, drum] of layout.drums.entries()) {
      const configured = kit.drums[i]!;
      const expected = [configured.origin.x * (mirror === 'x' ? -1 : 1) / 100, configured.origin.z / 100, configured.origin.y * (mirror === 'y' ? -1 : 1) / 100];
      drum.center.forEach((value, k) => expect(value).toBeCloseTo(expected[k]!, 8));
      expect(drum.radius).toBeCloseTo(configured.diameterIn * 25.4 / 200, 8);
      expect(drum.depth).toBeCloseTo(3 * configured.hoopSpacingMm / 100 + 0.24, 8);
      expect(drum.hoopCenters).toHaveLength(4);
      expect(drum.estimatedDepth).toBe(false);
      const axis = new Vector3(...drum.axis);
      for (let p = drum.pixelStart; p < drum.pixelStart + drum.pixelCount; p++) {
        const point = new Vector3(...sceneVector(model.positions, p, 100));
        const delta = point.clone().sub(new Vector3(...drum.center));
        const axial = delta.dot(axis);
        expect(delta.addScaledVector(axis, -axial).length()).toBeCloseTo(drum.radius, 7);
        expect(point.y).toBeGreaterThan(layout.floorY);
      }
    }
  });

  it('recovers a cylinder even at one pixel per hoop (not a first-pixel gizmo or centroid)', () => {
    const drum = { ...DEFAULT_KIT.drums[0]!, hoops: [{ pixelCount: 1, reverse: false }, { pixelCount: 1, reverse: true }] };
    const layout = buildStageLayout(kitModel({ ...DEFAULT_KIT, drums: [drum] }));
    layout.drums[0]!.center.forEach((value, i) => expect(value).toBeCloseTo([drum.origin.x / 100, drum.origin.z / 100, drum.origin.y / 100][i]!, 8));
    expect(layout.drums[0]!.radius).toBeCloseTo(drum.diameterIn * 25.4 / 200);
    expect(layout.drums[0]!.depth).toBeCloseTo(drum.hoopSpacingMm / 100 + 0.24);
  });

  it('estimates only the unknowable single-hoop depth, preserving its measured plane and radius', () => {
    const drum = { ...DEFAULT_KIT.drums[1]!, hoops: [{ pixelCount: 7, reverse: true }] };
    const body = buildStageLayout(kitModel({ ...DEFAULT_KIT, drums: [drum] })).drums[0]!;
    expect(body.estimatedDepth).toBe(true);
    expect(body.depth).toBeGreaterThan(0);
    expect(body.radius).toBeCloseTo(drum.diameterIn * 25.4 / 200);
    body.center.forEach((value, i) => expect(value).toBeCloseTo([drum.origin.x / 100, drum.origin.z / 100, drum.origin.y / 100][i]!));
  });

  it('accepts missing and valid empty geometry with finite camera/floor bounds', () => {
    for (const model of [null, emptyModel(), { ...emptyModel(), drums: [{ id: 'empty', label: 'Empty', color: '#fff', pixelStart: 0, pixelCount: 0 }] }]) {
      const layout = buildStageLayout(model);
      expect(layout.drums).toEqual([]);
      expect([...layout.center, layout.floorY, layout.size].every(Number.isFinite)).toBe(true);
    }
  });

  it('caps decorative bodies but frames the whole kit', () => {
    const kit = { ...DEFAULT_KIT, drums: Array.from({ length: MAX_STAGE_DRUMS + 3 }, (_, i) => ({
      ...DEFAULT_KIT.drums[0]!, id: `d${i}`, origin: { x: i * 1000, y: 0, z: 300 }, hoops: [{ pixelCount: 3, reverse: false }],
    })) };
    const layout = buildStageLayout(kitModel(kit));
    expect(layout.drums).toHaveLength(MAX_STAGE_DRUMS);
    expect(layout.omittedDrums).toBe(3);
    expect(layout.size).toBeGreaterThan(340);
  });
});
