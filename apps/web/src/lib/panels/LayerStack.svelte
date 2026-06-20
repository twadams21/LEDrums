<script lang="ts">
  import type { Layer } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';

  const BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'lighten', 'max'] as const;

  const layers = $derived(store.project?.composition.layers ?? []);

  function selectLayer(id: string): void {
    store.selectLayer(id);
  }

  function setBlend(layer: Layer, e: Event): void {
    const mode = (e.currentTarget as HTMLSelectElement).value as Layer['blendMode'];
    store.setLayer(layer.id, { blendMode: mode });
  }

  function setOpacity(layer: Layer, e: Event): void {
    const opacity = Number((e.currentTarget as HTMLInputElement).value);
    store.setLayer(layer.id, { opacity });
  }

  function setActiveClip(layer: Layer, e: Event): void {
    const val = (e.currentTarget as HTMLSelectElement).value;
    store.setLayer(layer.id, { activeClipId: val === '' ? null : val });
  }

  function removeLayer(layer: Layer): void {
    store.removeLayer(layer.id);
  }

  function addLayer(): void {
    const id = `layer-${Date.now().toString(36)}`;
    store.addLayer({
      id,
      name: 'New Layer',
      role: 'effect',
      blendMode: 'normal',
      opacity: 1,
      clips: [],
      activeClipId: null,
    });
    store.selectLayer(id);
  }
</script>

<section class="layers">
  {#if layers.length === 0}
    <div class="empty">
      <p>No layers yet.</p>
      <button class="primary" onclick={addLayer}>+ Add Layer</button>
    </div>
  {:else}
    <!-- Top of the stack composites last; show top-most first. -->
    <ul>
      {#each [...layers].reverse() as layer (layer.id)}
        <li class:selected={layer.id === store.selectedLayerId}>
          <div class="head">
            <button class="name" onclick={() => selectLayer(layer.id)} title="Select layer">
              <span class="role role-{layer.role}">{layer.role}</span>
              {layer.name || layer.id}
            </button>
            <button class="x" onclick={() => removeLayer(layer)} aria-label="Remove layer">✕</button>
          </div>
          <div class="ctrls">
            <label class="ctrl">
              <span>blend</span>
              <select value={layer.blendMode} onchange={(e) => setBlend(layer, e)}>
                {#each BLEND_MODES as mode (mode)}
                  <option value={mode}>{mode}</option>
                {/each}
              </select>
            </label>
            <label class="ctrl op">
              <span>opacity {Math.round(layer.opacity * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={layer.opacity}
                oninput={(e) => setOpacity(layer, e)}
              />
            </label>
            <label class="ctrl">
              <span>clip</span>
              <select value={layer.activeClipId ?? ''} onchange={(e) => setActiveClip(layer, e)}>
                <option value="">— none —</option>
                {#each layer.clips as clip (clip.id)}
                  <option value={clip.id}>{clip.name || clip.effectId}</option>
                {/each}
              </select>
            </label>
          </div>
        </li>
      {/each}
    </ul>
    <button class="add primary" onclick={addLayer}>+ Add Layer</button>
  {/if}
</section>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    background: var(--panel-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 8px;
  }
  li.selected {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-dim);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    padding: 2px 0;
    font-weight: 600;
  }
  .name:hover {
    background: transparent;
    color: var(--accent);
  }
  .role {
    display: inline-block;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: 3px;
    margin-right: 6px;
    background: #222b3a;
    color: var(--text-dim);
  }
  .role-base {
    color: #7fd1ff;
  }
  .role-trigger {
    color: #ffb05a;
  }
  .role-effect {
    color: #c08bff;
  }
  .role-automation {
    color: #5affc0;
  }
  .x {
    padding: 2px 6px;
    color: var(--text-faint);
    border-color: transparent;
    background: transparent;
  }
  .x:hover {
    color: var(--live);
    background: transparent;
  }
  .ctrls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }
  .ctrl {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ctrl > span {
    color: var(--text-dim);
    font-size: 10px;
    min-width: 92px;
  }
  .ctrl select {
    flex: 1;
  }
  .ctrl.op input {
    flex: 1;
  }
  .empty {
    color: var(--text-faint);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .empty p {
    margin: 0;
  }
  .add {
    align-self: flex-start;
  }
</style>
