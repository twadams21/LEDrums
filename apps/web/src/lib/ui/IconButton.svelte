<script module lang="ts">
  let nextDisabledReasonId = 0;
</script>

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
    /** Explain why a disabled button is unavailable. The reason is exposed to
        assistive technology and remains available from the keyboard. */
    disabledReason?: string;
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
    disabledReason,
    tooltipSide = 'top',
    class: klass,
  }: Props = $props();

  const disabledReasonId = `icon-button-disabled-reason-${++nextDisabledReasonId}`;
  const hasDisabledReason = $derived(disabled && Boolean(disabledReason));

  function handleClick(event: MouseEvent): void {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

{#snippet btn()}
  <button
    class={['ib', `ib-${variant}`, klass]}
    type="button"
    onclick={handleClick}
    {disabled}
    aria-label={label}
    aria-describedby={hasDisabledReason ? disabledReasonId : undefined}
  >
    <Icon {size} aria-hidden="true" />
  </button>
{/snippet}

<!-- A disabled native button cannot receive focus, so Tooltip's trigger span remains
     the keyboard target. The button itself stays genuinely disabled: it cannot fire
     the callback, and the hidden description also covers assistive tech that inspects
     the button directly. A supplied reason always gets a Tooltip, even when callers
     disabled ordinary label tooltips, because the reason is an accessibility contract. -->
{#if (tooltip || hasDisabledReason) && (!disabled || hasDisabledReason)}
  <Tooltip
    text={hasDisabledReason ? disabledReason! : label}
    side={tooltipSide}
    triggerRole={hasDisabledReason ? 'group' : undefined}
    triggerLabel={hasDisabledReason ? label : undefined}
    triggerDescribedBy={hasDisabledReason ? disabledReasonId : undefined}
    triggerDisabled={hasDisabledReason}
  >{@render btn()}</Tooltip>
{:else}
  {@render btn()}
{/if}
{#if hasDisabledReason}
  <span id={disabledReasonId} class="sr-only">{disabledReason}</span>
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
      background-color var(--dur-120) ease,
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
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
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
