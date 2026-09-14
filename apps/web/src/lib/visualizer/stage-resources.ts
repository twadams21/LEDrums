import {
  BufferGeometry, DoubleSide, Group, Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, Texture,
} from 'three';
import type { SerializedModel } from '../ws/protocol-types';
import type { StageAsset, StageRole } from './stage-asset';
import { isStageRole } from './stage-asset';
import { bindStageHoops, MAX_STAGE_HOOPS, stageMismatch, stagePoseMatrix, type StageHoopBinding } from './stage-binding';
import { createStageLedAtlas, createStageLedMaterial } from './stage-led-atlas';
import { MAX_STAGE_DRUMS } from './stage-geometry';

export type StageQuality = 'eco' | 'detail';
export const stageDpr = (quality: StageQuality): number => quality === 'detail' ? 1.5 : 1;
export interface StageFallback { id: string; label: string; reason: string }

function validateRoleMeshes(root: Object3D, hoopCount: number): boolean {
  let valid = true;
  const lit = new Set<number>();
  const roles = new Set<StageRole>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const role: unknown = node.userData.stageRole;
    if (!isStageRole(role) || !(node.geometry instanceof BufferGeometry) || !node.geometry.getAttribute('position')) { valid = false; return; }
    roles.add(role);
    if (role === 'led-lens' || role === 'led-tape') {
      const hoop: unknown = node.userData.stageHoop;
      if (typeof hoop !== 'number' || !Number.isInteger(hoop) || hoop < 1 || hoop > hoopCount) valid = false;
      else lit.add(hoop);
    }
  });
  return valid && lit.size === hoopCount && roles.has('acrylic') && roles.has('metal') && roles.has('head');
}

/** Only clone scene nodes; loaded geometry remains asset-owned. A snapshot owns its derived
 * materials + atlas, never any source geometry/material. No shell surrogate, stands, average
 * shell emission, lights or postprocessing. Rigid pose replaces the source root placement;
 * every child transform is retained, including when resolving shader body-local coordinates. */
export function createStageResources(asset: StageAsset, model: SerializedModel, quality: StageQuality, environment?: () => Texture) {
  const group = new Group();
  const materials = new Set<Material>();
  const matchedDrums = new Set<string>();
  const fallbacks: StageFallback[] = [];
  const allHoops: StageHoopBinding[] = [];
  const plans: { source: Object3D; drum: SerializedModel['drums'][number]; hoops: StageHoopBinding[]; row: number }[] = [];
  for (const drum of model.drums) {
    const reference = asset.manifest.drums.find((entry) => entry.id === drum.id);
    const source = asset.roots.get(drum.id);
    let reason = stageMismatch(drum, reference, model);
    if (!reason && (!source || !validateRoleMeshes(source, drum.stage!.hoopPixelCounts.length))) reason = 'asset parts unavailable';
    if (!reason && (plans.length >= MAX_STAGE_DRUMS || allHoops.length + drum.stage!.hoopPixelCounts.length > MAX_STAGE_HOOPS)) reason = 'Stage preview limit';
    let hoops: StageHoopBinding[] = [];
    if (!reason) {
      try { hoops = bindStageHoops(model, drum); } catch { reason = 'invalid LED geometry'; }
    }
    if (reason) { fallbacks.push({ id: drum.id, label: drum.label || drum.id, reason }); continue; }
    plans.push({ source: source!, drum, hoops, row: allHoops.length });
    allHoops.push(...hoops);
    matchedDrums.add(drum.id);
  }
  const atlas = plans.length ? createStageLedAtlas(allHoops) : null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent(); group.clear();
    for (const material of materials) material.dispose();
    materials.clear(); atlas?.dispose();
  };
  try {
    // No optics allocation for a wholly incompatible model, even in Stage.
    const envMap = plans.length ? environment?.() ?? null : null;
    const roleMaterials = new Map<StageRole, Material>();
    function materialFor(role: StageRole): Material {
      const existing = roleMaterials.get(role);
      if (existing) return existing;
      let material: Material;
      switch (role) {
        case 'acrylic':
          material = quality === 'detail'
            ? new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0, transmission: 1, ior: 1.49,
              thickness: 5 / 1000, envMap, envMapIntensity: 0.7, side: DoubleSide, depthWrite: false })
            : new MeshStandardMaterial({ color: '#e8f0f1', roughness: 0.12, metalness: 0, transparent: true,
              opacity: 0.1, envMap, envMapIntensity: 0.6, side: DoubleSide, depthWrite: false });
          break;
        case 'metal': material = new MeshStandardMaterial({ color: '#dce0e3', metalness: 1, roughness: 0.18, envMap, envMapIntensity: 1.1 }); break;
        case 'head': material = new MeshStandardMaterial({ color: '#e6e5df', metalness: 0, roughness: 0.78, side: DoubleSide, envMap, envMapIntensity: 0.25 }); break;
        case 'diffuser-body': material = new MeshStandardMaterial({ color: '#e6e6df', roughness: 0.65, side: DoubleSide }); break;
        case 'pcb': material = new MeshStandardMaterial({ color: '#252b24', roughness: 0.7 }); break;
        default: material = new MeshStandardMaterial({ color: '#181a1b', roughness: 0.9 });
      }
      material.name = `stage-${role}-${quality}`;
      materials.add(material); roleMaterials.set(role, material);
      return material;
    }
    for (const plan of plans) {
      const root = plan.source.clone(true);
      // The source CAD arrangement is not the authored pose. This node defines drum-local
      // coordinates; ONLY its placement is replaced. Child geometry/transforms are untouched.
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      root.matrix.identity(); root.matrixAutoUpdate = false;
      root.updateMatrixWorld(true);
      root.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const role = node.userData.stageRole as StageRole; // validated before any clone/allocation
        if (role === 'led-lens' || role === 'led-tape') {
          const hoopIndex = Number(node.userData.stageHoop) - 1;
          const material = createStageLedMaterial(atlas!, plan.row + hoopIndex, plan.hoops[hoopIndex]!, node.matrixWorld.clone());
          node.material = material; materials.add(material);
        } else node.material = materialFor(role);
        node.castShadow = false; node.receiveShadow = false;
        node.renderOrder = role === 'acrylic' ? 1 : 0;
      });
      root.matrix.copy(stagePoseMatrix(plan.drum.stage!));
      root.matrixWorldNeedsUpdate = true;
      root.name = `stage-drum:${plan.drum.id}`;
      group.add(root);
    }
    return { group, matchedDrums, fallbacks, atlas, update: (frame: Uint8Array | null) => { if (!disposed) atlas?.update(frame); }, dispose };
  } catch (error) { dispose(); throw error; }
}
