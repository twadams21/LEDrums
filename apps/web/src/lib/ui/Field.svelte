<script lang="ts">
  /* Label + control wrapper: a label above its control with an optional hint.
     Stacks vertically; use inside form rows. */
  import type { Snippet } from 'svelte';

  type Props = {
    label: string;
    hint?: string;
    for?: string;
    class?: string;
    children: Snippet;
  };

  let { label, hint, for: forId, class: klass, children }: Props = $props();
</script>

<label class={['field', klass]} for={forId}>
  <span class="flabel">{label}{#if hint}<em class="fhint">{hint}</em>{/if}</span>
  {@render children()}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .flabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .fhint {
    font-style: normal;
    color: var(--text-faint);
  }
</style>
