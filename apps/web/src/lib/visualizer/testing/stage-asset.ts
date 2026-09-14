import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { DEFAULT_KIT, type KitConfig } from '@ledrums/core';
import { ownStageAsset, type StageManifest, type StageManifestDrum } from '../stage-asset';

const dimensions = [
  ['kick', 256.75, 94, 196], ['snare', 139.25, 182 / 3, 108],
  ['tom1', 139.25, 182 / 3, 108], ['tom2', 179.25, 322 / 3, 136],
] as const;
export const referenceDrums: StageManifestDrum[] = dimensions.map(([id, radiusMm, hoopSpacingMm, count]) => ({
  id, cadId: id, rootName: `kit:${id}`, radiusMm, hoopSpacingMm, hoopPixelCounts: [count, count, count, count],
}));
export function referenceKit(): KitConfig {
  return { ...DEFAULT_KIT, drums: DEFAULT_KIT.drums.map((drum) => {
    const reference = referenceDrums.find((entry) => entry.id === drum.id)!;
    return { ...drum, diameterIn: reference.radiusMm * 2 / 25.4, hoopSpacingMm: reference.hoopSpacingMm };
  }) };
}

/** Deliberately tiny geometry, NOT a stand-in for a GPU/real-GLB fidelity claim. Nested nodes
 * exercise GLTFLoader's retained child transforms; all placeholders must be replaced. */
export function fixtureStageScene() {
  const scene = new Group();
  const material = new MeshBasicMaterial({ color: '#ff0000' });
  const box = new BoxGeometry(0.1, 0.1, 0.1);
  const manifest: StageManifest = { version: 1, units: 'metres', axes: 'gltf-y-up',
    source: { path: 'fixture.blend', sha256: 'a'.repeat(64) }, drums: referenceDrums.map((drum) => ({ ...drum, hoopPixelCounts: [...drum.hoopPixelCounts] })) };
  for (const drum of manifest.drums) {
    const root = new Group(); root.name = drum.rootName; root.userData.stageDrumId = drum.id;
    // A saved source arrangement must not leak into the authored drum pose.
    root.position.set(19, 23, 41);
    const nested = new Group(); nested.rotation.y = 0.37;
    root.add(nested); scene.add(root);
    for (const role of ['acrylic', 'head', 'metal', 'gasket', 'pcb', 'diffuser-body']) {
      const mesh = new Mesh(box, material); mesh.name = role; mesh.userData.stageRole = role;
      mesh.position.y = 0.02; nested.add(mesh);
    }
    for (let hoop = 1; hoop <= 4; hoop++) {
      const geometry = new CylinderGeometry(drum.radiusMm / 1000, drum.radiusMm / 1000, 0.005, 12, 1, true);
      for (const role of ['led-lens', 'led-tape']) {
        const mesh = new Mesh(geometry, material);
        mesh.userData = { stageRole: role, stageHoop: hoop }; mesh.name = `${role}:${hoop}`;
        mesh.position.y = (hoop - 2.5) * drum.hoopSpacingMm / 1000;
        nested.add(mesh);
      }
    }
  }
  return { scene, manifest };
}
export function fixtureStageAsset() {
  const { scene, manifest } = fixtureStageScene();
  return ownStageAsset(scene, manifest);
}
