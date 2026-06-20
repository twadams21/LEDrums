<script lang="ts">
  import type { Clip } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';

  const layer = $derived(store.selectedLayer);
  const clips = $derived(layer?.clips ?? []);

  let addEffectId = $state('');

  function trigger(clipId: string): void {
    if (!layer) return;
    store.setLayer(layer.id, { activeClipId: clipId });
  }

  function addClip(): void {
    if (!layer) return;
    const effectId = addEffectId || store.effects[0]?.id;
    if (!effectId) return;
    const spec = store.effectById(effectId);
    const params: Record<string, number | string | boolean> = {};
    for (const p of spec?.paramSpec ?? []) params[p.key] = p.default;
    const clip: Clip = {
      id: `clip-${Date.now().toString(36)}`,
      name: spec?.name ?? effectId,
      effectId,
      params,
      modulations: [],
    };
    store.addClip(layer.id, clip);
  }

  function removeClip(clipId: string): void {
    if (layer) store.removeClip(layer.id, clipId);
  }
</script>

<section class="clips">
  {#if !layer}
    <div class="empty">Select a layer to see its clips.</div>
  {:else}
    {#if clips.length === 0}
      <div class="empty">No clips on <strong>{layer.name || layer.id}</strong> yet.</div>
    {:else}
      <div class="grid">
        {#each clips as clip (clip.id)}
          <div class="cell-wrap">
            <button
              class="cell"
              class:active={clip.id === layer.activeClipId}
              onclick={() => trigger(clip.id)}
              title={clip.effectId}
            >
              <span class="cn">{clip.name || clip.effectId}</span>
              <span class="ce">{clip.effectId}</span>
            </button>
            <button class="del" onclick={() => removeClip(clip.id)} aria-label="Delete clip">✕</button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="add-row">
      <select bind:value={addEffectId} aria-label="Effect to add">
        {#if store.effects.length === 0}
          <option value="">— no effects —</option>
        {:else}
          {#each store.effects as fx (fx.id)}
            <option value={fx.id}>{fx.name} ({fx.category})</option>
          {/each}
        {/if}
      </select>
      <button class="primary" onclick={addClip} disabled={store.effects.length === 0}>
        + Add Clip
      </button>
    </div>
  {/if}
</section>

<style>
  .clips {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(82px, 1fr));
    gap: 6px;
  }
  .cell-wrap {
    position: relative;
  }
  .cell {
    width: 100%;
    aspect-ratio: 1.5 / 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 2px;
    text-align: center;
    padding: 4px;
    background: var(--panel-raised);
    border: 1px solid var(--border);
  }
  .cell.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    box-shadow: 0 0 10px rgba(78, 161, 255, 0.4);
  }
  .cn {
    font-weight: 600;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    white-space: nowrap;
  }
  .ce {
    font-size: 9px;
    color: var(--text-faint);
  }
  .del {
    position: absolute;
    top: 2px;
    right: 2px;
    padding: 0 4px;
    font-size: 10px;
    line-height: 16px;
    color: var(--text-faint);
    background: rgba(0, 0, 0, 0.4);
    border-color: transparent;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .cell-wrap:hover .del {
    opacity: 1;
  }
  .del:hover {
    color: var(--live);
  }
  .add-row {
    display: flex;
    gap: 6px;
  }
  .add-row select {
    flex: 1;
  }
  .empty {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
