<script lang="ts">
  /* Project-styled single select on Bits UI. The dropdown is portaled to the
     body (sits above dialogs via z-index) and composes with Bits Dialog's
     dismiss/focus layers. Pass `value` + `onChange`, or `bind:value`. */
  import { Select } from 'bits-ui';
  import { type Component } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Check from '@lucide/svelte/icons/check';

  type Option = { value: string; label: string; icon?: Component; iconColor?: string; disabled?: boolean };
  type Props = {
    value: string;
    options: Option[];
    onChange?: (v: string) => void;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value = $bindable(''),
    options,
    onChange,
    disabled = false,
    placeholder = 'Select…',
    ariaLabel,
    class: klass,
  }: Props = $props();

  const selected = $derived(options.find((o) => o.value === value));
</script>

<span class={['sel', klass]}>
  <Select.Root type="single" bind:value items={options} onValueChange={onChange} {disabled}>
    <Select.Trigger class="sel-trigger" aria-label={ariaLabel}>
      <span class="sel-lead">
        {#if selected?.icon}{@const I = selected.icon}<I size={14} style={selected.iconColor ? `color:${selected.iconColor}` : undefined} aria-hidden="true" />{/if}
        <Select.Value {placeholder} />
      </span>
      <ChevronDown class="sel-caret" size={14} aria-hidden="true" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="lab-sel-content" sideOffset={6}>
        <Select.Viewport>
          {#each options as opt (opt.value)}
            <Select.Item class="lab-sel-item" value={opt.value} label={opt.label} disabled={opt.disabled}>
              {#snippet children({ selected: isSel })}
                <span class="lab-sel-lead">
                  {#if opt.icon}{@const I = opt.icon}<I size={14} style={opt.iconColor ? `color:${opt.iconColor}` : undefined} aria-hidden="true" />{/if}
                  <span>{opt.label}</span>
                </span>
                {#if isSel}<Check class="lab-sel-check" size={14} aria-hidden="true" />{/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</span>

<style>
  .sel {
    display: inline-flex;
    min-width: 0;
  }
  .sel :global(.sel-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--text);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    cursor: pointer;
    transition-property: border-color, scale;
    transition-duration: 120ms;
    transition-timing-function: ease;
  }
  .sel :global(.sel-trigger[data-state='open']) {
    border-color: var(--border-strong);
  }
  .sel :global(.sel-trigger:active) {
    scale: 0.98;
  }
  .sel :global(.sel-trigger[data-placeholder]) {
    color: var(--text-faint);
  }
  .sel :global(.sel-lead) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .sel :global(.sel-caret) {
    color: var(--text-faint);
    transition: rotate 150ms ease;
  }
  .sel :global(.sel-trigger[data-state='open'] .sel-caret) {
    rotate: 180deg;
  }

  /* portaled to body — global, uniquely prefixed. Selects open inside Dialogs
     (EffectCreator / ClipSettings), so the dropdown rides a tier above
     --z-modal — below the context menu, above everything else. */
  :global(.lab-sel-content) {
    z-index: var(--z-toast);
    min-width: var(--bits-select-anchor-width, 9rem);
    max-height: 18rem;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
    transform-origin: top center;
    animation: sel-pop 130ms cubic-bezier(0.2, 0, 0, 1);
  }
  @keyframes -global-sel-pop {
    from {
      opacity: 0;
      scale: 0.97;
      translate: 0 -4px;
    }
    to {
      opacity: 1;
      scale: 1;
      translate: 0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-sel-content) {
      animation: none;
    }
  }
  :global(.lab-sel-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    border-radius: var(--radius-1);
    cursor: pointer;
    user-select: none;
  }
  :global(.lab-sel-lead) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  :global(.lab-sel-item[data-highlighted]) {
    background: var(--surface-inset);
    color: var(--ink);
  }
  :global(.lab-sel-item[data-selected]) {
    color: var(--ink);
  }
  :global(.lab-sel-check) {
    color: var(--accent);
  }
  :global(.lab-sel-item[data-disabled]) {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
