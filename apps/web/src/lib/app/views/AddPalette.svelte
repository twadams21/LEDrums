<script lang="ts">
  /* Node Editor drawer — the Add tab. A searchable, grouped list of everything the
     open graph can gain (node kinds, modifiers, modulation sources, devices…).
     Clicking an item adds it at a free spot near the visible canvas centre (the
     view owns placement). Replaces the floating canvas palette + the two add
     modals: one browsable surface, one interaction. */
  import type { Component } from 'svelte';
  import SearchField from '../../ui/SearchField.svelte';

  export type AddItem = {
    id: string;
    name: string;
    icon: Component;
    /** CSS colour for the icon chip (role/kind tint). */
    tint?: string;
    /** One-line qualifier shown right-aligned (e.g. "per-hit shape"). */
    hint?: string;
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

  let query = $state('');
  const q = $derived(query.trim().toLowerCase());
  const shown = $derived(
    q === ''
      ? groups
      : groups
          .map((g) => ({ ...g, items: g.items.filter((it) => it.name.toLowerCase().includes(q)) }))
          .filter((g) => g.items.length > 0),
  );
</script>

<div class="addpal">
  <div class="searchrow">
    <SearchField bind:value={query} placeholder="Search node types…" ariaLabel="Search node types" class="addpal-search" />
  </div>
  <div class="groups">
    {#each shown as g (g.key)}
      <section class="grp">
        <h5 class="glbl">{g.label}</h5>
        {#each g.items as it (it.id)}
          <button
            type="button"
            class="pitem"
            onclick={() => onAdd(it.id, g.key)}
            {disabled}
            title="Add {it.name}"
            style="--tint:{it.tint ?? 'var(--accent)'}"
          >
            {#if it.icon}{@const I = it.icon}<span class="pi"><I size={13} aria-hidden="true" /></span>{/if}
            <span class="pn">{it.name}</span>
            {#if it.hint}<span class="pd">{it.hint}</span>{/if}
          </button>
        {/each}
      </section>
    {/each}
    {#if shown.length === 0}
      <p class="none">Nothing matches “{query}”.</p>
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
  .searchrow {
    flex: none;
    padding: var(--space-2) var(--space-3);
  }
  .searchrow :global(.addpal-search) {
    width: 100%;
  }
  .groups {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 var(--space-2) var(--space-3);
  }
  .grp {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .glbl {
    margin: var(--space-3) var(--space-1) var(--space-1);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .pitem {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 6px var(--space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    text-align: left;
    cursor: pointer;
    /* hover feedback on graph chrome is instant (locked graph prefs) */
  }
  .pitem:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border-faint);
  }
  .pitem:active:not(:disabled) {
    scale: 0.98;
  }
  .pitem:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .pi {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: var(--radius-1);
    background: color-mix(in oklch, var(--tint) 16%, transparent);
    color: var(--tint);
  }
  .pn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text);
  }
  .pd {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .none {
    margin: var(--space-4) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .pitem:active:not(:disabled) {
      scale: 1;
    }
  }
</style>
