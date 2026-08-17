<script lang="ts">
  /* Change a node's SUBTYPE in place (F3 item 11) — the inspector companion to the flat
     Add-node menu. A node is added with a subtype (an effect collection, a modifier, a
     modulation source kind) and re-typed here, without deleting it and losing its wires and
     its position.

     It draws the palette's own icons and tints, so the thing you picked in the Add menu is
     recognisably the same thing here. That is also why it never segments: a segmented control
     renders an icon INSTEAD of its label, and this switcher needs both. */
  import type { Component } from 'svelte';
  import Select from '../../../ui/Select.svelte';

  type Option = { value: string; label: string; icon?: Component; iconColor?: string };

  let {
    label = 'Type',
    value,
    options,
    onChange,
    ariaLabel,
  }: {
    label?: string;
    value: string;
    options: Option[];
    onChange: (v: string) => void;
    ariaLabel: string;
  } = $props();
</script>

{#if options.length > 1}
  <label class="switchrow">
    <span class="k">{label}</span>
    <Select {value} {options} {onChange} {ariaLabel} segment={false} class="subsel" />
  </label>
{/if}

<style>
  .switchrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
  }
  .k {
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-2xs);
    white-space: nowrap;
  }
  .switchrow :global(.subsel) {
    flex: 1;
    min-width: 0;
  }
</style>
