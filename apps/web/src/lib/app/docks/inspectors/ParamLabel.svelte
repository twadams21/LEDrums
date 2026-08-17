<script lang="ts">
  /* A param row's label cell — the name, plus an `(i)` carrying the param's unit.

     F3 item 7 (Trent): the unit used to sit AFTER the number input, so a row with a unit
     pushed its input left of a row without one and no two number fields in a section lined
     up. The unit is reference information, not part of the value, so it moves onto the label
     as a hover tooltip and every input in the section shares one column.

     The tooltip carries the declared range alongside the unit when there is one — that is the
     other thing you want when you stop to ask "what is this measured in?". */
  import Tooltip from '../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';

  let {
    label,
    unit,
    min,
    max,
    title,
  }: { label: string; unit?: string; min?: number; max?: number; title?: string } = $props();

  const ranged = $derived(min !== undefined && max !== undefined);
  const hint = $derived(ranged ? `${unit} · ${min}–${max}` : (unit ?? ''));
</script>

<span class="pcell">
  <span class="plabel" title={title ?? label}>{label}</span>
  {#if unit}
    <Tooltip text={hint}>
      <span class="uinfo" aria-label={`Unit: ${hint}`}><Info size={11} aria-hidden="true" /></span>
    </Tooltip>
  {/if}
</span>

<style>
  .pcell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* instant on hover — no transition, the house rule for inspector affordances */
  .uinfo {
    display: inline-flex;
    align-items: center;
    flex: none;
    color: var(--text-disabled);
    line-height: 0;
    cursor: help;
  }
  .uinfo:hover {
    color: var(--text-muted);
  }
</style>
