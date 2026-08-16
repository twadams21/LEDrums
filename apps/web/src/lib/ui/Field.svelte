<script lang="ts">
  /* Label + control wrapper. Two layouts:
     - `stack` (default): label above its control — dialogs, wide forms.
     - `row`: label column left, control right — the inspector/editor rhythm
       (label column = --field-label-col). Hint renders beside the label in
       stack, under the control in row.
     `unit` is a short trailing readout that sits OUTSIDE the control, in its own
     column after it (e.g. "ms" / "Hz" / a live "50%") — the inspector idiom for a
     numeric field or slider whose unit lives beside the box, not inside it. Row
     layout only; ignored in stack.
     `info` puts an ⓘ on the LABEL carrying an explanation on hover/focus. Settings
     uses it instead of `hint` (2026-08-14, Trent: no help text under fields) — a rule
     that only matters while you are filling the field belongs on demand, not as a line
     of permanent grey text under every input.
     `variant="group"` renders the wrapper as a div[role=group] + aria-labelledby
     instead of a <label>: for COMPOSITE controls (SegmentedControl and kin) where
     native label-forwarding would silently click the first inner button. */
  import type { Snippet } from 'svelte';
  import Info from '@lucide/svelte/icons/info';
  import Tooltip from './Tooltip.svelte';

  type Props = {
    label: string;
    hint?: string;
    /** Explanation shown on an ⓘ beside the label, on hover/focus. */
    info?: string;
    unit?: string;
    for?: string;
    layout?: 'stack' | 'row';
    /** 'label' (default) wraps in a <label>; 'group' wraps in div[role=group] for
        composite controls a label click would mis-activate. */
    variant?: 'label' | 'group';
    class?: string;
    children: Snippet;
  };

  let {
    label,
    hint,
    info,
    unit,
    for: forId,
    layout = 'stack',
    variant = 'label',
    class: klass,
    children,
  }: Props = $props();
  const hasUnit = $derived(unit != null && unit !== '' && layout === 'row');
  const group = $derived(variant === 'group');
  const uid = $props.id();
  const labelId = `${uid}-label`;
</script>

<svelte:element
  this={group ? 'div' : 'label'}
  class={['field', klass]}
  class:row={layout === 'row'}
  class:has-unit={hasUnit}
  for={group ? undefined : forId}
  role={group ? 'group' : undefined}
  aria-labelledby={group ? labelId : undefined}
>
  <span class="flabel" id={group ? labelId : undefined}>
    {label}
    {#if info}
      <Tooltip text={info} class="finfo"><Info size={12} aria-label={`About ${label}`} /></Tooltip>
    {/if}
    {#if hint && layout === 'stack'}<em class="fhint">{hint}</em>{/if}
  </span>
  <span class="fcontrol">{@render children()}</span>
  {#if hasUnit}<span class="funit">{unit}</span>{/if}
  {#if hint && layout === 'row'}<em class="fhint under">{hint}</em>{/if}
</svelte:element>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .field.row {
    display: grid;
    grid-template-columns: var(--field-label-col, 6.5rem) minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-2);
    row-gap: 3px;
  }
  .field.row.has-unit {
    grid-template-columns: var(--field-label-col, 6.5rem) minmax(0, 1fr) auto;
  }
  .flabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .field.row .flabel {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fcontrol {
    display: flex;
    min-width: 0;
  }
  .fcontrol > :global(*) {
    flex: 1;
    min-width: 0;
  }
  .funit {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .fhint {
    font-style: normal;
    color: var(--text-faint);
  }
  .flabel :global(.finfo) {
    color: var(--text-faint);
    cursor: help;
  }
  .flabel :global(.finfo:hover) {
    color: var(--text-muted);
  }
  .fhint.under {
    grid-column: 2;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
  }
</style>
