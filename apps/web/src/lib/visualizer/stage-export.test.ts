import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { DEFAULT_KIT } from '@ledrums/core';
import { Box3, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ownStageAsset, parseStageManifest } from './stage-asset';
import { createStageResources } from './stage-resources';
import { kitModel } from './testing/model';
import { buildStageLayout } from './stage-geometry';
import { createCameraFraming } from './stage-camera';

it('bundled asset dimensions and strip identity agree with the canonical default kit', async () => {
  const manifest = parseStageManifest(JSON.parse(await readFile('public/models/acrylic-kit/kit.manifest.json', 'utf8')));
  for (const reference of manifest.drums) {
    const drum = DEFAULT_KIT.drums.find((candidate) => candidate.id === reference.id)!;
    expect(drum).toBeDefined();
    expect(Math.abs(drum.diameterIn * 25.4 / 2 - reference.radiusMm)).toBeLessThan(1e-7);
    expect(Math.abs(drum.hoopSpacingMm - reference.hoopSpacingMm)).toBeLessThan(1e-7);
    expect(drum.hoops?.map((hoop) => hoop.pixelCount)).toEqual(reference.hoopPixelCounts);
  }
});

/** The actual bundled export is part of ordinary CI, not an opt-in local fixture.
 * CPU parsing/material binding only — no WebGL appearance, GPU timing or fidelity claim. */
it('binds the actual GLB to current default dimensions without stretching/source materials', async () => {
  const manifest = parseStageManifest(JSON.parse(await readFile('public/models/acrylic-kit/kit.manifest.json', 'utf8')));
  const bytes = await readFile('public/models/acrylic-kit/kit.glb');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const asset = ownStageAsset(gltf.scene, manifest);
  const model = kitModel();
  const resources = createStageResources(asset, model, 'detail');
  try {
    expect(resources.fallbacks).toEqual([]);
    expect([...resources.matchedDrums]).toEqual(['kick', 'snare', 'tom1', 'tom2']);
    resources.group.updateMatrixWorld(true);
    for (const drum of model.drums) {
      const source = asset.roots.get(drum.id)!;
      const posed = resources.group.getObjectByName(`stage-drum:${drum.id}`)!;
      expect(Math.abs(posed.matrix.determinant())).toBeCloseTo(1000);
      source.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const copy = posed.getObjectByName(node.name) as Mesh;
        expect(copy.geometry).toBe(node.geometry);
        expect(copy.material).not.toBe(node.material);
        expect(copy.matrix.elements).toEqual(node.matrix.elements);
      });
    }
    // Tight framing must retain actual heads/rims/hardware in every preset, even a narrow dock.
    const layout = buildStageLayout(model);
    const bounds = new Box3().setFromObject(resources.group);
    for (const aspect of [0.35, 1, 1.65, 3]) for (const preset of ['overview', 'audience', 'front', 'top'] as const) {
      const pose = createCameraFraming()(layout.center, layout.size, aspect, preset, 0, layout.halfExtents);
      const camera = new PerspectiveCamera(45, aspect, pose.near, pose.far);
      camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true);
      for (let corner = 0; corner < 8; corner++) {
        const point = new Vector3(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.93);
        expect(Math.abs(point.y)).toBeLessThan(0.93);
        expect(point.z).toBeGreaterThan(-1); expect(point.z).toBeLessThan(1);
      }
    }
    resources.update(new Uint8Array(model.count * 3).fill(151));
    expect(resources.atlas!.texture.image.data[0]).toBe(151);
    resources.update(null);
    expect(resources.atlas!.texture.image.data[0]).toBe(0);
  } finally { resources.dispose(); asset.dispose(); }
});
