<script lang="ts">
  /* One label + control line on a device face. The label column is fixed so every control on a
     card starts on the same x; the control sits right-aligned in the rest. */
  import type { Snippet } from 'svelte';

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="line">
  <span class="k">{label}</span>
  <span class="v">{@render children()}</span>
</div>

<style>
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* A dense card (the Trigger card) tightens its lines through the variable. */
    min-height: var(--line-h, 24px);
    min-width: 0;
  }
  .k {
    width: 4.5rem;
    flex: none;
    overflow: hidden;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .v {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
