<script lang="ts">
  /* Standardized square icon button (close / swap / add / etc). Wraps a Lucide
     icon component with an accessible label, a custom tooltip, and three weights. */
  import type { Component } from 'svelte';
  import Tooltip from './Tooltip.svelte';

  type Props = {
    icon: Component;
    label: string;
    onclick?: (e: MouseEvent) => void;
    size?: number;
    variant?: 'ghost' | 'soft' | 'solid';
    disabled?: boolean;
    /** Show the custom tooltip on hover (default true). */
    tooltip?: boolean;
    tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
    class?: string;
  };

  let {
    icon: Icon,
    label,
    onclick,
    size = 16,
    variant = 'ghost',
    disabled = false,
    tooltip = true,
    tooltipSide = 'top',
    class: klass,
  }: Props = $props();
</script>

{#snippet btn()}
  <button class={['ib', `ib-${variant}`, klass]} type="button" {onclick} {disabled} aria-label={label}>
    <Icon {size} aria-hidden="true" />
  </button>
{/snippet}

{#if tooltip && !disabled}
  <Tooltip text={label} side={tooltipSide}>{@render btn()}</Tooltip>
{:else}
  {@render btn()}
{/if}

<style>
  .ib {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-icon-size);
    height: var(--control-icon-size);
    padding: 0;
    border-radius: var(--radius-2);
    line-height: 0;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      scale 120ms ease;
  }
  .ib:active {
    scale: 0.94;
  }
  .ib-ghost {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-faint);
  }
  .ib-ghost:hover {
    background: var(--surface-inset);
    color: var(--ink);
  }
  .ib-soft {
    background: var(--surface-inset);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .ib-soft:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .ib-solid {
    background: var(--accent);
    border: 1px solid var(--accent-bright);
    color: var(--on-accent);
  }
  .ib-solid:hover {
    filter: brightness(1.06);
  }
  .ib:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
