import { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

export const STAGE_MODEL_URL = '/models/acrylic-kit/kit.glb';
export const STAGE_MANIFEST_URL = '/models/acrylic-kit/kit.manifest.json';
export const STAGE_ROLES = ['acrylic', 'head', 'metal', 'gasket', 'pcb', 'diffuser-body', 'led-lens', 'led-tape'] as const;
export type StageRole = typeof STAGE_ROLES[number];
export interface StageManifestDrum {
  id: string; cadId: string; rootName: string; radiusMm: number; hoopSpacingMm: number; hoopPixelCounts: number[];
}
export interface StageManifest {
  version: 1; source: { path: string; sha256: string }; units: 'metres'; axes: 'gltf-y-up'; drums: StageManifestDrum[];
}
export interface StageAsset {
  manifest: StageManifest;
  roots: ReadonlyMap<string, Object3D>;
  dispose(): void;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export const isStageRole = (value: unknown): value is StageRole => STAGE_ROLES.some((role) => role === value);

/** Validate the export boundary before trusting dimensions or allocating an LED atlas. */
export function parseStageManifest(value: unknown): StageManifest {
  if (!record(value) || value.version !== 1 || value.units !== 'metres' || value.axes !== 'gltf-y-up' ||
    !record(value.source) || !text(value.source.path) || !text(value.source.sha256) || !/^[a-f\d]{64}$/i.test(value.source.sha256) ||
    !Array.isArray(value.drums) || value.drums.length === 0 || value.drums.length > 32) throw new Error('Invalid Stage manifest');
  const ids = new Set<string>();
  const names = new Set<string>();
  const drums = value.drums.map((drum): StageManifestDrum => {
    if (!record(drum) || !text(drum.id) || !text(drum.cadId) || !text(drum.rootName) ||
      !positive(drum.radiusMm) || !positive(drum.hoopSpacingMm) || !Array.isArray(drum.hoopPixelCounts) ||
      drum.hoopPixelCounts.length !== 4 || !drum.hoopPixelCounts.every((n) => positive(n) && Number.isInteger(n)) ||
      ids.has(drum.id) || names.has(drum.rootName)) throw new Error('Invalid Stage drum manifest');
    ids.add(drum.id); names.add(drum.rootName);
    return { id: drum.id, cadId: drum.cadId, rootName: drum.rootName, radiusMm: drum.radiusMm,
      hoopSpacingMm: drum.hoopSpacingMm, hoopPixelCounts: [...drum.hoopPixelCounts] };
  });
  return { version: 1, units: 'metres', axes: 'gltf-y-up', source: { path: value.source.path, sha256: value.source.sha256 }, drums };
}

/** The loaded geometry and placeholders belong to ONE Stage mount, never a material snapshot. */
export function ownStageAsset(scene: Object3D, manifest: StageManifest): StageAsset {
  const resources = new Set<BufferGeometry | Material | Texture>();
  const roots = new Map<string, Object3D>();
  scene.traverse((node) => {
    if (node instanceof Mesh) {
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
      }
    }
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const resource of resources) resource.dispose();
    resources.clear(); roots.clear(); scene.removeFromParent(); scene.clear();
  };
  try {
    for (const drum of manifest.drums) {
      const candidates: Object3D[] = [];
      // GLTFLoader sanitizes ':' in .name; the original name survives in userData.name.
      scene.traverse((node) => {
        if (node.userData.stageDrumId === drum.id || node.name === drum.rootName || node.userData.name === drum.rootName) candidates.push(node);
      });
      if (candidates.length !== 1 || candidates[0]!.userData.stageDrumId !== drum.id) throw new Error('Stage drum root missing or ambiguous');
      roots.set(drum.id, candidates[0]!);
    }
    return { manifest, roots, dispose };
  } catch (error) { dispose(); throw error; }
}

/** No module-level promise/cache: Pixels neither loads GLTFLoader nor requests model files.
 * Fetch is abortable; parse is not, so a late parsed scene must still be retired. */
export async function loadStageAsset(signal: AbortSignal): Promise<StageAsset> {
  const response = await fetch(STAGE_MANIFEST_URL, { signal });
  if (!response.ok) throw new Error('Stage manifest unavailable');
  const manifest = parseStageManifest(await response.json());
  const [{ GLTFLoader }, binary] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    fetch(STAGE_MODEL_URL, { signal }).then((result) => {
      if (!result.ok) throw new Error('Stage model unavailable');
      return result.arrayBuffer();
    }),
  ]);
  if (signal.aborted) throw new Error('Stage load cancelled');
  const gltf = await new GLTFLoader().parseAsync(binary, '/models/acrylic-kit/');
  const asset = ownStageAsset(gltf.scene, manifest);
  if (signal.aborted) { asset.dispose(); throw new Error('Stage load cancelled'); }
  return asset;
}
