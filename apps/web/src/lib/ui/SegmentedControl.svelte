<script lang="ts">
  /* Radio-style segmented control on Bits UI ToggleGroup (single). Bits clears
     to "" when the active item is re-clicked; we mirror the value and refuse
     that so exactly one option stays selected. Pass `value` + `onChange`. */
  import { ToggleGroup } from 'bits-ui';
  import { untrack, type Component } from 'svelte';

  type Option = { value: string; label: string; icon?: Component; disabled?: boolean };
  type Props = {
    value: string;
    options: Option[];
    onChange?: (v: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let { value, options, onChange, disabled = false, ariaLabel, class: klass }: Props = $props();

  let current = $state(untrack(() => value));
  $effect(() => {
    current = value;
  });

  function handle(v: string): void {
    if (v === '') {
      current = value; // refuse deselect
      return;
    }
    onChange?.(v);
  }
</script>

<div class={['seg', klass]}>
  <ToggleGroup.Root
    type="single"
    bind:value={current}
    onValueChange={handle}
    {disabled}
    aria-label={ariaLabel}
    class="seg-row"
  >
    {#each options as opt (opt.value)}
      <ToggleGroup.Item
        class={opt.icon ? 'seg-btn icononly' : 'seg-btn'}
        value={opt.value}
        disabled={opt.disabled}
        title={opt.label}
        aria-label={opt.icon ? opt.label : undefined}
      >
        {#if opt.icon}{@const I = opt.icon}<I size={15} aria-hidden="true" />{:else}{opt.label}{/if}
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>

<style>
  .seg {
    display: inline-flex;
  }
  .seg :global(.seg-row) {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .seg :global(.seg-btn) {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    background: var(--surface-inset);
    border: none;
    border-radius: 0;
    color: var(--text-faint);
    cursor: pointer;
    white-space: nowrap;
    transition-property: background-color, color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .seg :global(.seg-btn.icononly) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    padding: var(--space-1) var(--space-2);
  }
  .seg :global(.seg-btn:active) {
    scale: 0.96;
  }
  .seg :global(.seg-btn:not(:last-child)) {
    border-right: 1px solid var(--border-faint);
  }
  .seg :global(.seg-btn:hover) {
    color: var(--text);
  }
  .seg :global(.seg-btn[data-state='on']) {
    background: var(--accent-soft);
    color: var(--ink);
  }
  .seg :global(.seg-btn[data-state='on']:hover) {
    color: var(--ink);
  }
  .seg :global(.seg-btn:focus-visible) {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-soft);
  }
  .seg :global(.seg-btn:disabled) {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
