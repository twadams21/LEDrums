<script lang="ts">
  /* Project-styled single select on Bits UI. The dropdown is portaled to the
     body (sits above dialogs via z-index) and composes with Bits Dialog's
     dismiss/focus layers. Pass `value` + `onChange`, or `bind:value`.

     A SHORT choice is not a dropdown (F3 item 10, Trent): four options or fewer render as a
     segmented control instead — every choice visible, one click to switch, no menu to open
     and dismiss to read three words. That decision lives HERE rather than at each call site
     so it holds everywhere the app offers a choice, and so a registry that grows past four
     entries turns back into a dropdown by itself.

     Two cases are deliberately NOT segmented: an ACTION picker whose value is a placeholder
     ("Add parameter…" — it commands rather than shows state, and has no selected segment to
     render), and any site that opts out with `segment={false}`.

     The line for opting out: a FIXED vocabulary segments (Art-Net / sACN, Gate / Velocity,
     None / X / Y — short, and the app chose the words). A list of names the app did NOT
     choose — user-authored presets, effect and scene names, a machine's network interfaces —
     stays a dropdown, because a segment clips where a trigger ellipsises. */
  import { Select } from 'bits-ui';
  import { type Component } from 'svelte';
  import SegmentedControl from './SegmentedControl.svelte';
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
    /** Opt out of the ≤4-options segmented rendering and stay a dropdown. */
    segment?: boolean;
  };

  let {
    value = $bindable(''),
    options,
    onChange,
    disabled = false,
    placeholder = 'Select…',
    ariaLabel,
    class: klass,
    segment = true,
  }: Props = $props();

  const selected = $derived(options.find((o) => o.value === value));
  /** Short, stateful, opted-in → a segmented control. See the header note for the exclusions. */
  const SEGMENT_MAX = 4;
  const segmented = $derived(segment && options.length > 1 && options.length <= SEGMENT_MAX && !!selected);

  function choose(v: string): void {
    value = v;
    onChange?.(v);
  }
</script>

{#if segmented}
  <!-- Labels only: SegmentedControl renders an icon INSTEAD of its label, and a row of bare
       glyphs is only legible where the call site chose icons deliberately (play mode, layer). -->
  <SegmentedControl
    {value}
    options={options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
    onChange={choose}
    {disabled}
    {ariaLabel}
    class={['sel-as-seg', klass].filter(Boolean).join(' ')}
  />
{:else}
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
{/if}

<style>
  /* A segmented Select inherits the caller's sizing class, so wherever a dropdown filled its
     column the segments do too — the substitution must not change the row's shape. */
  :global(.sel-as-seg .seg-row) {
    display: flex;
    flex: 1;
    min-width: 0;
  }
  :global(.sel-as-seg .seg-btn) {
    flex: 1;
    justify-content: center;
    text-align: center;
  }
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
    height: var(--control-h, 26px);
    padding: 0 var(--space-2);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--text);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    cursor: pointer;
    transition-property: border-color, scale;
    transition-duration: var(--dur-120);
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
     (e.g. ClipSettings), so the dropdown rides a tier above
     --z-modal — below the context menu, above everything else. */
  :global(.lab-sel-content) {
    z-index: var(--z-toast);
    min-width: var(--bits-select-anchor-width, 9rem);
    /* F3 item 9: 18rem made a list of eight scroll on a tall screen for no reason. A dropdown
       may use 80% of the viewport before it has to scroll anything. */
    max-height: 80vh;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
    transform-origin: top center;
    animation: sel-pop 130ms var(--ease-control);
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
