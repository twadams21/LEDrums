<script lang="ts">
  /* Underline tab strip on Bits UI Tabs. Renders the tab list only — the caller
     switches content off the bound `value`. Tabs may carry an optional icon. */
  import { Tabs } from 'bits-ui';
  import type { Component } from 'svelte';

  type Tab = { value: string; label: string; icon?: Component };
  type Props = {
    value: string;
    tabs: Tab[];
    onChange?: (v: string) => void;
    ariaLabel?: string;
    class?: string;
  };

  let { value = $bindable(''), tabs, onChange, ariaLabel, class: klass }: Props = $props();
</script>

<div class={['tabs', klass]}>
  <Tabs.Root bind:value onValueChange={onChange}>
    <Tabs.List class="tabs-list" aria-label={ariaLabel}>
      {#each tabs as t (t.value)}
        <Tabs.Trigger value={t.value} class="tabs-trigger">
          {#if t.icon}{@const I = t.icon}<I size={14} aria-hidden="true" />{/if}
          <span>{t.label}</span>
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
  </Tabs.Root>
</div>

<style>
  .tabs :global(.tabs-list) {
    display: inline-flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border-faint);
  }
  .tabs :global(.tabs-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-2) var(--space-3);
    margin-bottom: -1px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--text-faint);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: color var(--dur-120) ease, border-color var(--dur-120) ease, scale var(--dur-120) ease;
  }
  .tabs :global(.tabs-trigger:hover) {
    color: var(--text);
  }
  .tabs :global(.tabs-trigger:active) {
    scale: 0.97;
  }
  .tabs :global(.tabs-trigger[data-state='active']) {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .tabs :global(.tabs-trigger:focus-visible) {
    outline: none;
    color: var(--ink);
  }
</style>
