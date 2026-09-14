import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import { loadStageAsset, ownStageAsset, parseStageManifest, STAGE_MANIFEST_URL, STAGE_MODEL_URL } from './stage-asset';
import { fixtureStageScene } from './testing/stage-asset';

const loader = vi.hoisted(() => ({ construct: vi.fn(), parse: vi.fn() }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {
  constructor() { loader.construct(); }
  parseAsync(...args: unknown[]) { return loader.parse(...args); }
} }));
beforeEach(() => { loader.construct.mockClear(); loader.parse.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function network(manifest: unknown) {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => manifest })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Stage export boundary', () => {
  it('validates manifest units, axes, version, reference dimensions and duplicate identities', () => {
    const { scene, manifest } = fixtureStageScene();
    expect(parseStageManifest(manifest)).toEqual(manifest);
    for (const change of [{ version: 2 }, { units: 'mm' }, { axes: 'cad' }, { source: { path: 'test', sha256: 'wrong' } },
      { drums: [manifest.drums[0], manifest.drums[0]] }, { drums: [{ ...manifest.drums[0], radiusMm: NaN }] },
      { drums: [{ ...manifest.drums[0], hoopPixelCounts: [1, 2] }] }]) {
      expect(() => parseStageManifest({ ...manifest, ...change })).toThrow(/manifest/);
    }
    ownStageAsset(scene, manifest).dispose();
  });

  it('owns each shared geometry/placeholder once and resolves GLTFLoader-sanitized roots by extras', () => {
    const { scene, manifest } = fixtureStageScene();
    const source = scene.getObjectByName('metal') as Mesh;
    const geometry = vi.spyOn(source.geometry, 'dispose');
    const material = vi.spyOn(Array.isArray(source.material) ? source.material[0]! : source.material, 'dispose');
    for (const root of scene.children) { root.userData.name = root.name; root.name = root.name.replace(':', ''); }
    const asset = ownStageAsset(scene, manifest);
    expect([...asset.roots.keys()]).toEqual(['kick', 'snare', 'tom1', 'tom2']);
    asset.dispose(); asset.dispose();
    expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });

  it('cleans loaded geometry on a broken export/root contract', () => {
    const { scene, manifest } = fixtureStageScene();
    const source = scene.getObjectByName('metal') as Mesh;
    const dispose = vi.spyOn(source.geometry, 'dispose');
    delete scene.children[0]!.userData.stageDrumId;
    expect(() => ownStageAsset(scene, manifest)).toThrow(/root/);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('requests only the manifest and GLB at the Stage call, with abortable fetches and a lazy loader', async () => {
    const { scene, manifest } = fixtureStageScene(), abort = new AbortController();
    const fetch = network(manifest); loader.parse.mockResolvedValueOnce({ scene });
    expect(fetch).not.toHaveBeenCalled(); expect(loader.construct).not.toHaveBeenCalled();
    const asset = await loadStageAsset(abort.signal);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([STAGE_MANIFEST_URL, STAGE_MODEL_URL]);
    expect(fetch.mock.calls.every((call) => call[1].signal === abort.signal)).toBe(true);
    expect(loader.construct).toHaveBeenCalledTimes(1);
    expect(asset.roots.size).toBe(4);
    asset.dispose();
  });

  it('does not request/parse a model after an invalid manifest or HTTP failure', async () => {
    const fetch = network({ version: 99 });
    await expect(loadStageAsset(new AbortController().signal)).rejects.toThrow(/manifest/);
    expect(fetch).toHaveBeenCalledTimes(1); expect(loader.construct).not.toHaveBeenCalled();
    fetch.mockReset().mockResolvedValueOnce({ ok: false });
    await expect(loadStageAsset(new AbortController().signal)).rejects.toThrow(/unavailable/);
    expect(loader.parse).not.toHaveBeenCalled();
  });

  it('disposes a parsed scene that finishes after cancellation', async () => {
    const { scene, manifest } = fixtureStageScene(), abort = new AbortController();
    const dispose = vi.spyOn((scene.getObjectByName('metal') as Mesh).geometry, 'dispose');
    network(manifest);
    loader.parse.mockImplementationOnce(async () => { abort.abort(); return { scene }; });
    await expect(loadStageAsset(abort.signal)).rejects.toThrow(/cancelled/);
    expect(dispose).toHaveBeenCalledTimes(1); expect(scene.children).toHaveLength(0);
  });
});
