import { describe, expect, it, vi } from 'vitest';
import { Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { createStageResources, stageDpr } from './stage-resources';
import { emptyModel, kitModel } from './testing/model';
import { fixtureStageAsset, referenceKit } from './testing/stage-asset';

function ownedMaterials(group: ReturnType<typeof createStageResources>['group']) {
  const materials = new Set<Material>();
  group.traverse((node) => {
    if (node instanceof Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  return [...materials];
}

describe('actual Stage asset resources', () => {
  it.each(['none', 'x', 'y'] as const)('rigidly poses nested real geometry under mirror %s, without stretching or adopting the CAD arrangement', (mirror) => {
    const kit = referenceKit();
    kit.global.mirror = mirror;
    kit.drums = kit.drums.map((drum, i) => ({ ...drum, flip: i % 2 === 0,
      origin: { x: 730 + i * 47, y: -200, z: 900 }, rotation: { x: 27, y: -32, z: 51 } }));
    const model = kitModel(kit), asset = fixtureStageAsset();
    const before = structuredClone(model);
    const resources = createStageResources(asset, model, 'eco');
    expect(resources.fallbacks).toEqual([]);
    expect(resources.matchedDrums.size).toBe(4);
    resources.group.updateMatrixWorld(true);
    for (const drum of model.drums) {
      const pose = drum.stage!;
      const body = resources.group.getObjectByName(`stage-drum:${drum.id}`)!;
      const center = body.localToWorld(new Vector3());
      expect(center.distanceTo(new Vector3(pose.origin[0], pose.origin[2], pose.origin[1]).divideScalar(100))).toBeLessThan(1e-8);
      for (const [local, axis, sign] of [[new Vector3(1, 0, 0), pose.xAxis, 1], [new Vector3(0, 1, 0), pose.zAxis, 1], [new Vector3(0, 0, 1), pose.yAxis, -1]] as const) {
        const actual = body.localToWorld(local.clone()).sub(center);
        expect(actual.distanceTo(new Vector3(axis[0], axis[2], axis[1]).multiplyScalar(sign * 10))).toBeLessThan(1e-8);
      }
      expect(Math.abs(body.matrix.determinant())).toBeCloseTo(1000);
      const original = asset.roots.get(drum.id)!.getObjectByName('metal') as Mesh;
      const clone = body.getObjectByName('metal') as Mesh;
      expect(clone.geometry).toBe(original.geometry);
      expect(clone.position.toArray()).toEqual(original.position.toArray());
      expect(clone.parent!.quaternion.toArray()).toEqual(original.parent!.quaternion.toArray());
      expect(clone.material).not.toBe(original.material);
    }
    expect(model).toEqual(before);
    resources.dispose(); asset.dispose();
  });

  it('updates actual per-pixel texture bytes, clears null/truncated data and leaves source RGB/model/geometry untouched', () => {
    const model = kitModel(referenceKit()), asset = fixtureStageAsset();
    const resources = createStageResources(asset, model, 'eco');
    const before = ownedMaterials(resources.group);
    const frame = Uint8Array.from({ length: model.count * 3 }, (_, i) => i % 256), copy = frame.slice();
    const texture = resources.atlas!.texture;
    const allocation = texture.image.data;
    for (let i = 0; i < 20; i++) resources.update(frame);
    expect(texture.image.data).toBe(allocation);
    expect(ownedMaterials(resources.group)).toEqual(before);
    expect([...allocation.slice(0, 8)]).toEqual([0, 1, 2, 255, 3, 4, 5, 255]);
    expect(frame).toEqual(copy);
    resources.update(new Uint8Array([82]));
    expect([...allocation.slice(0, 8)]).toEqual([82, 0, 0, 255, 0, 0, 0, 255]);
    resources.update(null);
    expect([...allocation].filter((_, i) => i % 4 !== 3).every((n) => n === 0)).toBe(true);
    resources.dispose(); asset.dispose();
  });

  it.each(['eco', 'detail'] as const)('uses clear non-emissive acrylic, pale heads and chrome actual hardware in %s; invents no support geometry', (quality) => {
    const asset = fixtureStageAsset(), model = kitModel(referenceKit());
    const resources = createStageResources(asset, model, quality);
    const acrylic = resources.group.getObjectByName('acrylic') as Mesh;
    const material = acrylic.material as MeshStandardMaterial;
    expect(material.emissive.getHex()).toBe(0);
    expect(material.depthWrite).toBe(false);
    if (quality === 'detail') {
      expect(material).toBeInstanceOf(MeshPhysicalMaterial);
      expect((material as MeshPhysicalMaterial).transmission).toBe(1);
      expect((material as MeshPhysicalMaterial).ior).toBe(1.49);
    } else {
      expect(material).not.toBeInstanceOf(MeshPhysicalMaterial);
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeLessThan(0.2);
    }
    const head = (resources.group.getObjectByName('head') as Mesh).material as MeshStandardMaterial;
    expect(head.color.r).toBeGreaterThan(0.7);
    expect(head.emissive.getHex()).toBe(0);
    expect(((resources.group.getObjectByName('metal') as Mesh).material as MeshStandardMaterial).metalness).toBe(1);
    resources.group.traverse((node) => {
      expect(node.type).not.toContain('Light');
      expect(node.name).not.toMatch(/stand|leg|shell|spill|floor|halo/);
    });
    expect(resources.group.children).toHaveLength(4);
    resources.dispose(); asset.dispose();
  });

  it('keeps mismatched, unmeasured and unknown drums in Pixels with specific reasons, never blank/approximate bodies', () => {
    const model = kitModel(referenceKit()), asset = fixtureStageAsset();
    model.drums[0]!.stage!.radiusMm += 0.051;
    delete model.drums[1]!.stage;
    model.drums[2]!.id = 'custom';
    const resources = createStageResources(asset, model, 'detail');
    expect([...resources.matchedDrums]).toEqual(['tom2']);
    expect(resources.fallbacks.map((entry) => entry.reason)).toEqual(['dimensions differ', 'body placement unavailable', 'no matching asset']);
    expect(resources.group.children).toHaveLength(1);
    resources.dispose(); asset.dispose();
  });

  it('fails a missing/unclassified asset part back to Pixels rather than drawing a partial drum', () => {
    const model = kitModel(referenceKit()), asset = fixtureStageAsset();
    delete asset.roots.get('kick')!.getObjectByName('metal')!.userData.stageRole;
    const resources = createStageResources(asset, model, 'eco');
    expect(resources.matchedDrums.has('kick')).toBe(false);
    expect(resources.fallbacks[0]!.reason).toBe('asset parts unavailable');
    resources.dispose(); asset.dispose();
  });

  it('disposes snapshot materials/atlas exactly once without disposing borrowed asset geometry', () => {
    const model = kitModel(referenceKit()), asset = fixtureStageAsset();
    const source = asset.roots.get('kick')!.getObjectByName('metal') as Mesh;
    const disposeGeometry = vi.spyOn(source.geometry, 'dispose');
    const resources = createStageResources(asset, model, 'eco');
    const disposers = ownedMaterials(resources.group).map((material) => vi.spyOn(material, 'dispose'));
    const disposeTexture = vi.spyOn(resources.atlas!.texture, 'dispose');
    resources.dispose(); resources.dispose(); resources.update(new Uint8Array(model.count * 3));
    expect(resources.group.children).toHaveLength(0);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(disposeGeometry).not.toHaveBeenCalled();
    asset.dispose(); asset.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
  });

  it('allocates no optical resources for an empty or incompatible model; bounds quality DPR', () => {
    const asset = fixtureStageAsset(), environment = vi.fn();
    const resources = createStageResources(asset, emptyModel(), 'detail', environment);
    expect(resources.atlas).toBeNull();
    expect(resources.group.children).toHaveLength(0);
    expect(environment).not.toHaveBeenCalled();
    resources.update(null); resources.dispose(); asset.dispose();
    expect(stageDpr('eco')).toBe(1); expect(stageDpr('detail')).toBe(1.5);
  });
});
