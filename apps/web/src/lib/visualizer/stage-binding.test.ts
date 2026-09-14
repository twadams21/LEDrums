import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh, MeshBasicMaterial, ShaderLib, Vector3 } from 'three';
import { bindStageHoops, MAX_STAGE_HOOPS, MAX_STAGE_PIXELS_PER_HOOP, stageMismatch, stagePixelAtAngle } from './stage-binding';
import { createStageResources } from './stage-resources';
import { createStageLedAtlas } from './stage-led-atlas';
import { kitModel } from './testing/model';
import { fixtureStageAsset, referenceDrums, referenceKit } from './testing/stage-asset';

// Actual shader rewrites/uniforms; no test pretends that this compiles on a GPU.
function compileLed(mesh: Mesh) {
  const material = mesh.material as MeshBasicMaterial;
  const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], null!);
  return shader as typeof shader & { uniforms: Record<string, { value: any }> };
}

describe('body-local live LED binding', () => {
  for (const mirror of ['none', 'x', 'y'] as const) for (const flip of [false, true]) for (const reverse of [false, true]) {
    it(`samples every real pixel under mirror=${mirror}, flip=${flip}, reverse=${reverse}, arbitrary start/spin`, () => {
      const kit = referenceKit();
      kit.global.mirror = mirror;
      kit.drums = kit.drums.map((drum, index) => ({ ...drum, flip, localSpinDeg: 71, startAngleDeg: -197 + index * 43,
        origin: { x: 720, y: -350, z: 1800 }, rotation: { x: 47, y: -28, z: 23 },
        hoops: [1, 2, 11, 19].map((pixelCount, h) => ({ pixelCount, reverse: h % 2 ? !reverse : reverse })),
      }));
      const model = kitModel(kit);
      for (const drum of model.drums) {
        const pose = drum.stage!;
        const hoops = bindStageHoops(model, drum);
        expect(hoops.map((hoop) => hoop.start)).toEqual([0, 1, 3, 14].map((i) => i + drum.pixelStart));
        for (const hoop of hoops) for (let i = 0; i < hoop.count; i++) {
          const n = new Vector3().fromArray(model.normals, (hoop.start + i) * 3);
          const angle = Math.atan2(n.dot(new Vector3(...pose.yAxis)), n.dot(new Vector3(...pose.xAxis)));
          expect(stagePixelAtAngle(angle, hoop)).toBe(i);
          expect(stagePixelAtAngle(angle - Math.PI * 6, hoop)).toBe(i);
          expect(stagePixelAtAngle(angle + Math.PI * 8, hoop)).toBe(i);
        }
      }
      const asset = fixtureStageAsset();
      const resources = createStageResources(asset, model, 'eco');
      expect(resources.fallbacks).toEqual([]); // Strip density changes do not stretch the body.
      const frame = new Uint8Array(model.count * 3);
      for (let i = 0; i < model.count; i++) frame.set([i % 256, (i + 31) % 256, (i + 67) % 256], i * 3);
      resources.update(frame);
      const atlas = resources.atlas!;
      let row = 0;
      for (const drum of model.drums) {
        for (const hoop of bindStageHoops(model, drum)) {
          for (let pixel = 0; pixel < hoop.count; pixel++) {
            const offset = (row * atlas.width + pixel) * 4;
            expect([...atlas.texture.image.data.slice(offset, offset + 3)]).toEqual([...frame.slice((hoop.start + pixel) * 3, (hoop.start + pixel) * 3 + 3)]);
          }
          row++;
        }
      }
      resources.dispose(); asset.dispose();
    });
  }

  it('retains nested mesh transforms in shader coordinates and samples nearest centred pixels, not source color', () => {
    const asset = fixtureStageAsset(), model = kitModel(referenceKit());
    const resources = createStageResources(asset, model, 'eco');
    const drum = resources.group.getObjectByName('stage-drum:kick')!;
    const lens = drum.getObjectByName('led-lens:1') as Mesh;
    const shader = compileLed(lens);
    expect(shader.fragmentShader).toContain('atan(-vStagePosition.z, vStagePosition.x)');
    expect(shader.fragmentShader).toContain('floor(stageTurn * stageCount + 0.5)');
    // GPU reciprocal division can make n * (1/n) < 1. GLSL mod(n,n) can then
    // return n and sample a short row's black padding. Real-GLB GPU readback caught it.
    expect(Math.fround(109 * Math.fround(1 / 109))).toBeLessThan(1);
    expect(shader.fragmentShader).toContain('stagePixel >= stageCount ? 0.0 : stagePixel');
    expect(shader.fragmentShader).not.toContain('mod(floor(stageTurn');
    expect(shader.fragmentShader).toContain('(stagePixel + 0.5) / stageAtlasWidth');
    expect(shader.uniforms.stageAtlas!.value).toBe(resources.atlas!.texture);
    expect(shader.uniforms.stageRow!.value).toBe(0);
    expect(shader.uniforms.stageCount!.value).toBe(model.drums[0]!.stage!.hoopPixelCounts[0]);
    const transform = shader.uniforms.stageMeshToDrum!.value as Matrix4;
    // Root pose is deliberately NOT in this matrix; child's own + its parent transform are.
    const expected = lens.parent!.matrix.clone().multiply(lens.matrix);
    expect(transform.elements).toEqual(expected.elements);
    const before = transform.elements.slice();
    resources.group.updateMatrixWorld(true);
    expect(transform.elements).toEqual(before);
    expect((lens.material as MeshBasicMaterial).vertexColors).toBe(false);
    resources.dispose(); asset.dispose();
  });

  it('rejects physical dimension/hoop changes, corrupt placement/counts, and oversized rows', () => {
    const base = kitModel(referenceKit());
    const reference = referenceDrums[0]!;
    const drum = base.drums[0]!;
    expect(stageMismatch(drum, reference, base)).toBeNull();
    const mutations = [
      (p: NonNullable<typeof drum.stage>) => p.hoopSpacingMm += 0.051,
      (p: NonNullable<typeof drum.stage>) => p.radiusMm -= 0.051,
      (p: NonNullable<typeof drum.stage>) => p.hoopPixelCounts.pop(),
      (p: NonNullable<typeof drum.stage>) => p.xAxis[0] += 0.1,
      (p: NonNullable<typeof drum.stage>) => p.hoopPixelCounts[0] = 0,
      (p: NonNullable<typeof drum.stage>) => p.hoopPixelCounts[0] = MAX_STAGE_PIXELS_PER_HOOP + 1,
      (p: NonNullable<typeof drum.stage>) => p.hoopPixelCounts[0]! -= 1,
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(drum); mutate(changed.stage!);
      expect(stageMismatch(changed, reference, base)).not.toBeNull();
    }
    const withinTolerance = structuredClone(drum); withinTolerance.stage!.radiusMm += 0.049;
    expect(stageMismatch(withinTolerance, reference, base)).toBeNull();
  });

  it('bounds atlas allocation and clears padding/missing channels between frames', () => {
    const rows = [{ start: 2, count: 2, phase: 0, direction: 1 as const }, { start: 0, count: 1, phase: 0, direction: 1 as const }];
    const atlas = createStageLedAtlas(rows), data = atlas.texture.image.data;
    atlas.update(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect([...data]).toEqual([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 0, 0, 0, 0]);
    atlas.update(new Uint8Array([31]));
    expect([...data]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 31, 0, 0, 255, 0, 0, 0, 0]);
    atlas.update(null);
    expect([...data].filter((_, i) => i % 4 !== 3).every((n) => n === 0)).toBe(true);
    atlas.dispose();
    expect(() => createStageLedAtlas([{ ...rows[0]!, count: MAX_STAGE_PIXELS_PER_HOOP + 1 }])).toThrow(/limit/);
    expect(() => createStageLedAtlas(Array.from({ length: MAX_STAGE_HOOPS + 1 }, () => rows[0]!))).toThrow(/limit/);
  });
});
