import { untrack } from 'svelte';
import type { Texture } from 'three';
import type { SerializedModel } from '../ws/protocol-types';
import { loadStageAsset, type StageAsset } from './stage-asset';
import { createStageResources, type StageQuality } from './stage-resources';

export interface StageStatus { kind: 'loading' | 'ready' | 'fallback' | 'error'; message: string }
export const STAGE_LOADING: StageStatus = { kind: 'loading', message: 'Loading acrylic kit · showing Pixels' };
type Environment = { texture: Texture; dispose(): void };

/** Asset ownership is mount-scoped; material/texture snapshots are model + quality-scoped.
 * Neither frame arrivals nor incidental store invalidations are a lifetime boundary. */
export function createStageView(inputs: () => { model: SerializedModel; quality: StageQuality }, environmentFactory?: () => Environment) {
  let asset = $state.raw<StageAsset | null>(null);
  let resources = $state.raw<ReturnType<typeof createStageResources> | null>(null);
  let error = $state('');
  let resourceError = $state('');
  let environment: Environment | undefined;
  let previous: ReturnType<typeof inputs> | undefined;
  const geometry = $derived.by(() => {
    const next = inputs();
    if (previous?.model === next.model && previous.quality === next.quality) return previous;
    return previous = next;
  });
  $effect(() => {
    const abort = new AbortController();
    let active = true;
    let owned: StageAsset | undefined;
    untrack(() => loadStageAsset(abort.signal)).then((loaded) => {
      if (!active) { loaded.dispose(); return; }
      owned = loaded; asset = loaded;
    }).catch(() => { if (active) error = 'Acrylic kit unavailable · showing Pixels. Reopen Stage to retry.'; });
    return () => {
      active = false; abort.abort();
      // Retire derived snapshots before shared geometry, regardless of effect cleanup order.
      untrack(() => resources?.dispose());
      owned?.dispose(); environment?.dispose();
    };
  });
  $effect(() => {
    const loaded = asset;
    const { model, quality } = geometry;
    if (!loaded) return;
    let next: ReturnType<typeof createStageResources> | null = null;
    try {
      next = untrack(() => createStageResources(loaded, model, quality, environmentFactory ? () => {
        environment ??= environmentFactory();
        return environment.texture;
      } : undefined));
      resourceError = '';
    } catch { resourceError = 'Stage materials unavailable · showing Pixels. Try Eco or reopen Stage.'; }
    resources = next;
    return () => next?.dispose();
  });
  const status = $derived.by((): StageStatus => {
    if (error || resourceError) return { kind: 'error', message: error || resourceError };
    if (!resources) return STAGE_LOADING;
    if (resources.fallbacks.length) return { kind: 'fallback', message: `Pixels: ${resources.fallbacks.map((drum) => `${drum.label} (${drum.reason})`).join('; ')}` };
    return { kind: 'ready', message: 'Acrylic kit · live LED RGB' };
  });
  return { get resources() { return resources; }, get status() { return status; } };
}
