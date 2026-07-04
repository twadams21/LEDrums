<script lang="ts">
  /* Label + control wrapper. Two layouts:
     - `stack` (default): label above its control — dialogs, wide forms.
     - `row`: label column left, control right — the inspector/editor rhythm
       (label column = --field-label-col). Hint renders beside the label in
       stack, under the control in row. */
  import type { Snippet } from 'svelte';

  type Props = {
    label: string;
    hint?: string;
    for?: string;
    layout?: 'stack' | 'row';
    class?: string;
    children: Snippet;
  };

  let { label, hint, for: forId, layout = 'stack', class: klass, children }: Props = $props();
</script>

<label class={['field', klass]} class:row={layout === 'row'} for={forId}>
  <span class="flabel">{label}{#if hint && layout === 'stack'}<em class="fhint">{hint}</em>{/if}</span>
  <span class="fcontrol">{@render children()}</span>
  {#if hint && layout === 'row'}<em class="fhint under">{hint}</em>{/if}
</label>

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
  .fhint {
    font-style: normal;
    color: var(--text-faint);
  }
  .fhint.under {
    grid-column: 2;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
  }
</style>
