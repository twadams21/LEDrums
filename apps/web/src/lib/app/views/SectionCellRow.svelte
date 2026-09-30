<script lang="ts">
  /* One occupied cell in a Sections-view column (effect chains S06c; replaces SectionGraphRow):
     the cell's address (row chip + column) over its Effect names in stack order. Clicking opens
     the cell in the Effects view (the column activates its section first). Presentational — the
     column owns the store / api calls.

     Visual language follows the old graph tile (surface-2, faint border, square card corners)
     so the setlist keeps its rhythm. The row chip carries the drum colour; a fully bypassed cell
     dims and wears a power-off glyph (icon + text, never colour alone). Hover is instant border
     colour only, no lift. */
  import PowerOff from '@lucide/svelte/icons/power-off';

  let {
    row,
    column,
    names,
    color,
    master = false,
    bypassed = false,
    active = false,
    onOpen,
  }: {
    /** Row label: "Kit", a drum name, or "Master". */
    row: string;
    /** Column label ("Head", "Always", …) or, for the Master, its chain summary. */
    column: string;
    /** What the cell holds, in stack order (Effect names / master modifier names). */
    names: readonly string[];
    /** Drum colour for the row chip. */
    color?: string;
    /** The section's Master chain row (modifier role colour). */
    master?: boolean;
    bypassed?: boolean;
    /** This cell is the one open in the Effects view. */
    active?: boolean;
    onOpen: () => void;
  } = $props();

  const detail = $derived(names.join(' · '));
  const title = $derived(`${row} · ${column}${bypassed ? ' (bypassed)' : ''}\n${names.join('\n')}`);
</script>

<button
  type="button"
  class="cellrow"
  class:active
  class:bypassed
  class:master
  data-cell-row
  aria-current={active ? 'true' : undefined}
  aria-label={`Open ${row} ${column} in Effects: ${detail}${bypassed ? ', bypassed' : ''}`}
  {title}
  style:--chip={color ?? null}
  onclick={onOpen}
>
  <span class="addr">
    <span class="chip" aria-hidden="true"></span>
    <span class="rowname">{row}</span>
    <span class="colname">{column}</span>
    <span class="trail">
      {#if bypassed}<PowerOff size={11} aria-hidden="true" />{/if}
      {#if names.length > 1}<span class="count">{names.length}</span>{/if}
    </span>
  </span>
  <span class="names">{detail}</span>
</button>

<style>
  .cellrow {
    --chip: var(--text-faint);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    min-height: 40px;
    padding: var(--space-1_5) var(--space-2);
    text-align: start;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    color: var(--text);
    cursor: pointer;
    transition: none;
  }
  .cellrow:hover {
    border-color: var(--border-strong);
    background: var(--surface-2);
  }
  .cellrow:active {
    scale: 1;
  }
  .cellrow.active {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
    background: color-mix(in oklab, var(--accent), var(--surface-2) 92%);
  }
  .cellrow.master {
    --chip: var(--role-effect);
  }
  .addr {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    min-width: 0;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .chip {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--chip);
  }
  .rowname {
    flex: none;
    font-weight: var(--font-semibold);
    color: var(--text-strong);
  }
  .colname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-inline-start: auto;
    color: var(--text-faint);
  }
  .count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .names {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--ink);
  }
  .cellrow.bypassed .names {
    color: var(--text-faint);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklab, var(--text-faint), transparent 40%);
  }
</style>
