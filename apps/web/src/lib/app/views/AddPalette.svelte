<script lang="ts">
  /* Node Editor drawer Add tab. Stage 1 is a compact category chooser; Stage 2
     stays empty until a category is selected, then shows the same NodeCard visual
     language that will appear on the canvas. */
  import type { Component } from 'svelte';
  import NodeCard from './NodeCard.svelte';
  import NodeSignalPreview from './NodeSignalPreview.svelte';
  import NodeStatePreview from './NodeStatePreview.svelte';
  import { addCategories, ADD_NODE_DRAG_TYPE, encodeAddDragPayload, selectedAddItems } from './add-pane';
  import { makeNode, type NodeKind } from '../../trigger-lab/sim';
  import { voice } from '@ledrums/core';

  export type AddItem = {
    id: string;
    name: string;
    icon: Component;
    /** CSS colour for the icon chip (role/kind tint). */
    tint?: string;
    /** Tight qualifier shown as the preview sub line. */
    hint?: string;
    /** Disabled entries are visible taxonomy seams for node types whose runtime has not landed. */
    disabled?: boolean;
    disabledReason?: string;
    preview?: 'route' | 'modulate' | 'modifier';
    previewKind?: NodeKind;
  };
  export type AddGroup = {
    key: string;
    label: string;
    items: readonly AddItem[];
  };

  let {
    groups,
    onAdd,
    disabled = false,
  }: {
    groups: readonly AddGroup[];
    onAdd: (id: string, groupKey: string) => void;
    /** Read-only viewer: browsing allowed, adding disabled. */
    disabled?: boolean;
  } = $props();

  let selectedKey = $state<string | null>(null);
  const categories = $derived(addCategories(groups));
  const selectedItems = $derived(selectedAddItems(groups, selectedKey));
  const selectedLabel = $derived(categories.find((c) => c.key === selectedKey)?.label ?? '');

  function dragstart(e: DragEvent, id: string, groupKey: string): void {
    if (disabled) return;
    e.dataTransfer?.setData(ADD_NODE_DRAG_TYPE, encodeAddDragPayload(id, groupKey));
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
  function addSelected(id: string): void {
    if (selectedKey === null) return;
    const item = selectedItems.find((it) => it.id === id);
    if (item?.disabled) return;
    onAdd(id, selectedKey);
  }
  function dragSelected(e: DragEvent, id: string): void {
    if (selectedKey === null) return;
    const item = selectedItems.find((it) => it.id === id);
    if (item?.disabled) return;
    dragstart(e, id, selectedKey);
  }

  function previewNode(it: AddItem) {
    const kind = it.previewKind;
    if (!kind) return null;
    if (kind === 'randomMod') return null;
    if (kind === 'envelope') {
      return makeNode('envelope', 'preview', 0, 0, { env: { [voice.ENVELOPE_NODE_KEY]: voice.defaultEnvelope('pluck') } });
    }
    if (kind === 'lfo') return makeNode('lfo', 'preview', 0, 0, { lfo: voice.defaultLfoSettings() });
    if (kind === 'cc') return makeNode('cc', 'preview', 0, 0, { ccController: 1, ccChannel: null });
    if (kind === 'note') return makeNode('note', 'preview', 0, 0, { noteNumber: 60, noteMode: 'velocity' });
    if (kind === 'osc') return makeNode('osc', 'preview', 0, 0, { oscAddress: '/ledrums/mod' });
    return makeNode(kind, 'preview', 0, 0);
  }
</script>

{#snippet paletteThumb(it: AddItem)}
  {@const node = previewNode(it)}
  {#if it.preview === 'modulate'}
    {#if it.previewKind === 'envelope' && node}
      <NodeSignalPreview kind="envelope" env={node.env?.[voice.ENVELOPE_NODE_KEY]} w={56} h={32} />
    {:else if it.previewKind === 'lfo' && node}
      <NodeSignalPreview kind="lfo" lfo={node.lfo} w={56} h={32} />
    {:else if it.previewKind === 'cc'}
      <NodeSignalPreview kind="cc" ccValue={() => 0.62} w={56} h={32} />
    {:else if it.previewKind === 'note'}
      <NodeSignalPreview kind="note" ccValue={() => 0.82} w={56} h={32} />
    {:else if it.previewKind === 'osc'}
      <NodeSignalPreview kind="osc" ccValue={() => 0.48} w={56} h={32} />
    {:else if it.previewKind === 'randomMod'}
      <NodeSignalPreview kind="random" w={56} h={32} />
    {/if}
  {:else if it.preview === 'route' && node}
    <NodeStatePreview node={node} childCount={3} tintToken="--role-effect" w={56} h={32} />
  {:else if it.preview === 'modifier' && node}
    <NodeStatePreview node={node} childCount={1} tintToken="--role-mod" w={56} h={32} />
  {/if}
{/snippet}

<div class="addpal">
  <div class="stage1" aria-label="Node categories">
    {#each categories as category (category.key)}
      <button
        type="button"
        class="cat"
        class:active={selectedKey === category.key}
        aria-pressed={selectedKey === category.key}
        onclick={() => (selectedKey = category.key)}
      >
        <span class="cat-name">{category.label}</span>
        <span class="cat-count">{category.count}</span>
      </button>
    {/each}
  </div>

  <div class="stage2" aria-live="polite">
    {#if selectedKey === null}
      <div class="empty">
        <p>Select a node category.</p>
      </div>
    {:else}
      <section class="previews" aria-label="{selectedLabel} nodes">
        <h5 class="glbl">{selectedLabel}</h5>
        {#each selectedItems as it (it.id)}
          <button
            type="button"
            class="preview"
            class:unavailable={it.disabled}
            onclick={() => addSelected(it.id)}
            draggable={!disabled && !it.disabled}
            ondragstart={(e) => dragSelected(e, it.id)}
            disabled={disabled || it.disabled}
            title={it.disabled ? (it.disabledReason ?? `${it.name} is not available yet`) : `Add ${it.name}`}
          >
            <NodeCard
              icon={it.icon}
              title={it.name}
              sub={it.hint ?? (it.disabled ? 'not available yet' : 'add node')}
              tint={it.tint ?? 'var(--accent)'}
              thumb={it.preview ? () => paletteThumb(it) : undefined}
            />
          </button>
        {/each}
        {#if selectedItems.length === 0}
          <p class="none">No node previews in this category.</p>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .addpal {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .stage1 {
    flex: none;
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--border-faint);
  }
  .cat {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 40px;
    padding: 0 var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur-120) ease, border-color var(--dur-120) ease, scale var(--dur-120) var(--ease-control);
  }
  .cat:hover {
    border-color: var(--border);
    background: var(--surface-3);
  }
  .cat:active {
    scale: 0.96;
  }
  .cat.active {
    border-color: var(--accent);
    color: var(--ink);
    background: color-mix(in oklch, var(--accent) 10%, var(--surface-2));
  }
  .cat-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .cat-count {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .stage2 {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2) var(--space-2) var(--space-3);
  }
  .previews {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .glbl {
    margin: var(--space-1) var(--space-1) 0;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .preview {
    display: block;
    width: 100%;
    min-height: 40px;
    padding: var(--space-1);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    cursor: pointer;
    text-align: left;
  }
  .preview:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border-faint);
  }
  .preview:active:not(:disabled) {
    scale: 0.96;
  }
  .preview:disabled {
    cursor: default;
  }
  .preview.unavailable {
    opacity: 0.54;
  }
  .preview :global(.card) {
    width: 100%;
    max-width: none;
    box-shadow: none;
    pointer-events: none;
  }
  .empty {
    min-height: 160px;
    display: grid;
    place-items: center;
    border: 1px dashed var(--border-faint);
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--surface-2) 56%, transparent);
  }
  .empty p {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .none {
    margin: var(--space-4) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .cat,
    .preview:active:not(:disabled) {
      scale: 1;
    }
  }
</style>
