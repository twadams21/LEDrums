// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { Mesh, Texture } from 'three';
import StageViewHost from './testing/StageViewHost.svelte';
import { loadStageAsset, type StageAsset } from './stage-asset';
import { createStageResources } from './stage-resources';
import { kitModel } from './testing/model';
import { fixtureStageAsset, referenceKit } from './testing/stage-asset';

vi.mock('./stage-asset', async (original) => ({ ...await original<typeof import('./stage-asset')>(), loadStageAsset: vi.fn() }));
// Real Svelte reactive lifetime + Three resources, no WebGL context or network.
vi.mock('./stage-resources', async (original) => {
  const real = await original<typeof import('./stage-resources')>();
  return { ...real, createStageResources: vi.fn((...args: Parameters<typeof real.createStageResources>) => {
    const result = real.createStageResources(...args);
    return { ...result, dispose: vi.fn(result.dispose) };
  }) };
});
function deferred() {
  let resolve!: (asset: StageAsset) => void, reject!: (error: Error) => void;
  const promise = new Promise<StageAsset>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const create = vi.mocked(createStageResources), load = vi.mocked(loadStageAsset);
beforeEach(() => { create.mockClear(); load.mockReset(); });

describe('Stage mount/asset/snapshot lifetime', () => {
  it('loads nothing in Pixels; retains asset across frames, model and quality changes; retires snapshots and shared geometry separately', async () => {
    const model = kitModel(referenceKit()), asset = fixtureStageAsset(), pending = deferred();
    const assetDispose = vi.spyOn(asset, 'dispose');
    const sourceMesh = asset.roots.get('kick')!.getObjectByName('acrylic') as Mesh;
    const geometryDispose = vi.spyOn(sourceMesh.geometry, 'dispose');
    const environment = { texture: new Texture(), dispose: vi.fn() }, makeEnvironment = vi.fn(() => environment);
    load.mockReturnValueOnce(pending.promise);
    const { rerender, unmount, getByTestId } = render(StageViewHost, { props: { active: false, model, frame: null, quality: 'eco', environment: makeEnvironment } });
    await tick();
    expect(load).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(makeEnvironment).not.toHaveBeenCalled();
    await rerender({ active: true });
    expect(getByTestId('stage-view').textContent).toMatch(/Loading.*Pixels/);
    expect(create).not.toHaveBeenCalled();
    pending.resolve(asset);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const first = create.mock.results[0]!.value as ReturnType<typeof createStageResources>;
    const firstTextureDispose = vi.spyOn(first.atlas!.texture, 'dispose');
    await rerender({ frame: new Uint8Array(model.count * 3).fill(72) });
    expect(create).toHaveBeenCalledTimes(1);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(first.atlas!.texture.image.data[0]).toBe(72);
    await rerender({ quality: 'detail' });
    expect(first.dispose).toHaveBeenCalledTimes(1); expect(firstTextureDispose).toHaveBeenCalledTimes(1);
    const second = create.mock.results[1]!.value as ReturnType<typeof createStageResources>;
    const secondTextureDispose = vi.spyOn(second.atlas!.texture, 'dispose');
    await rerender({ model: kitModel(referenceKit()), frame: null });
    expect(second.dispose).toHaveBeenCalledTimes(1); expect(secondTextureDispose).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1); expect(makeEnvironment).toHaveBeenCalledTimes(1);
    expect(assetDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    const third = create.mock.results[2]!.value as ReturnType<typeof createStageResources>;
    await rerender({ active: false });
    expect(third.group.children).toHaveLength(0);
    expect(assetDispose).toHaveBeenCalledTimes(1); expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(environment.dispose).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0].aborted).toBe(true);
    unmount(); expect(assetDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes a late load after leaving Stage, without publishing or allocating a snapshot', async () => {
    const pending = deferred(), asset = fixtureStageAsset(), dispose = vi.spyOn(asset, 'dispose');
    load.mockReturnValueOnce(pending.promise);
    const { rerender, unmount, queryByTestId } = render(StageViewHost, { props: { active: true, model: kitModel(referenceKit()), frame: null, quality: 'eco' } });
    await tick(); await rerender({ active: false });
    pending.resolve(asset); await pending.promise; await tick();
    expect(dispose).toHaveBeenCalledTimes(1); expect(create).not.toHaveBeenCalled();
    expect(queryByTestId('stage-view')).toBeNull();
    unmount();
  });

  it('surfaces failure without automatic refetch, and retry is a fresh Stage mount', async () => {
    load.mockRejectedValueOnce(new Error('HTTP 404'));
    const model = kitModel(referenceKit());
    const { rerender, unmount, getByTestId } = render(StageViewHost, { props: { active: true, model, frame: null, quality: 'eco' } });
    await waitFor(() => expect(getByTestId('stage-view').dataset.state).toBe('error'));
    expect(getByTestId('stage-view').textContent).toMatch(/unavailable.*Pixels.*retry/);
    await rerender({ frame: new Uint8Array(model.count * 3), quality: 'detail' });
    expect(load).toHaveBeenCalledTimes(1); expect(create).not.toHaveBeenCalled();
    const asset = fixtureStageAsset(), dispose = vi.spyOn(asset, 'dispose');
    load.mockResolvedValueOnce(asset);
    await rerender({ active: false }); await rerender({ active: true });
    await waitFor(() => expect(getByTestId('stage-view').dataset.state).toBe('ready'));
    expect(load).toHaveBeenCalledTimes(2);
    unmount(); expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('retains the loaded asset during mismatch and binds the newest model/quality if inputs change while loading', async () => {
    const pending = deferred(); load.mockReturnValueOnce(pending.promise);
    const model = kitModel(referenceKit());
    const { rerender, unmount, getByTestId } = render(StageViewHost, { props: { active: true, model, frame: null, quality: 'eco' } });
    const changed = structuredClone(model); changed.drums[0]!.stage!.radiusMm += 12;
    await rerender({ model: changed, quality: 'detail' });
    const asset = fixtureStageAsset(); pending.resolve(asset);
    await waitFor(() => expect(getByTestId('stage-view').dataset.state).toBe('fallback'));
    expect(getByTestId('stage-view').textContent).toMatch(/Pixels: Kick.*dimensions differ/);
    expect(create.mock.calls[0]![1]).toBe(changed); expect(create.mock.calls[0]![2]).toBe('detail');
    await rerender({ model });
    expect(getByTestId('stage-view').dataset.state).toBe('ready'); expect(load).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('cleans partially allocated snapshots on environment failure and can recover in place', async () => {
    const asset = fixtureStageAsset(); load.mockResolvedValueOnce(asset);
    const model = kitModel(referenceKit());
    const textureDispose = vi.spyOn(Texture.prototype, 'dispose');
    const recoveredEnvironment = { texture: new Texture(), dispose: vi.fn() };
    const makeEnvironment = vi.fn<() => typeof recoveredEnvironment>()
      .mockImplementationOnce(() => { throw new Error('renderer unavailable'); })
      .mockReturnValue(recoveredEnvironment);
    const { rerender, unmount, getByTestId } = render(StageViewHost, { props: { active: true, model, frame: null, quality: 'detail', environment: makeEnvironment } });
    await waitFor(() => expect(getByTestId('stage-view').dataset.state).toBe('error'));
    expect(getByTestId('stage-view').textContent).toMatch(/materials unavailable.*Pixels/);
    expect(textureDispose).toHaveBeenCalledTimes(1); // failed snapshot's atlas
    await rerender({ quality: 'eco' });
    expect(load).toHaveBeenCalledTimes(1); expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(getByTestId('stage-view').dataset.state).toBe('ready');
    unmount(); expect(recoveredEnvironment.dispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(2); textureDispose.mockRestore();
  });

  it('ignores rejection after unmount (no unhandled rejection or new resources)', async () => {
    const pending = deferred(); load.mockReturnValueOnce(pending.promise);
    const { unmount } = render(StageViewHost, { props: { active: true, model: kitModel(referenceKit()), frame: null, quality: 'eco' } });
    await tick(); unmount(); pending.reject(new Error('aborted')); await tick(); await tick();
    expect(create).not.toHaveBeenCalled();
  });
});
