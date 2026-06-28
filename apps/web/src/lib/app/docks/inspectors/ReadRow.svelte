<script lang="ts">
  /* A read-only label → value row (first/last pixel, transmit order, …) shared by the
     Patch + trigger editors. Value is mono, right-aligned, tabular. */
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="readrow">
  <span class="k">{label}</span>
  <span class="rval">{value}</span>
</div>

<style>
  .readrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--border-faint);
  }
  .k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
  }
  .rval {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 0;
  }
</style>
