<script lang="ts">
  /* One Effects-grid cell — presentational. The grid (EffectsGrid) owns selection, roving focus and
     the menu; this renders the face: the first Effect's generator icon + name, stack pips, bypass,
     and a fire flash. `variant="master"` is the Kit row's Master cell (the section's master
     modifier chain), `count` then being its modifier count.

     Fire flash: an overlay keyed on `fireAt`, so every fire restarts the decay (a drum roll reads
     as repeated hits) with no layout shift. A fire older than the flash is not replayed on mount. */
  import type { effectChain } from '@ledrums/core';
  import Plus from '@lucide/svelte/icons/plus';
  import PowerOff from '@lucide/svelte/icons/power-off';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { GENERATOR_ICONS, generatorLabel } from './generator-icons';

  type Props = {
    /** Accessible name ("Kick head", "Kit Always", "Master"). */
    label: string;
    variant?: 'cell' | 'master';
    enabled?: boolean;
    count: number;
    firstName?: string;
    firstGenerator?: effectChain.GeneratorKind;
    allBypassed?: boolean;
    selected?: boolean;
    /** The roving tab stop: the one cell the grid's Tab lands on. */
    tabbable?: boolean;
    /** Engine time (ms) of the last fire; 0 = never. */
    fireAt?: number;
    row?: number;
    col?: number;
    onselect?: () => void;
    onactivate?: () => void;
    onfocus?: () => void;
    oncontextmenu?: (event: MouseEvent) => void;
  };

  let {
    label,
    variant = 'cell',
    enabled = true,
    count,
    firstName,
    firstGenerator,
    allBypassed = false,
    selected = false,
    tabbable = false,
    fireAt = 0,
    row,
    col,
    onselect,
    onactivate,
    onfocus,
    oncontextmenu,
  }: Props = $props();

  const master = $derived(variant === 'master');
  const Icon = $derived(master ? SlidersHorizontal : firstGenerator ? GENERATOR_ICONS[firstGenerator] : null);
  const title = $derived(master ? 'Master' : firstName);
  const detail = $derived.by(() => {
    if (master) return count === 0 ? 'No modifiers' : `${count} modifier${count === 1 ? '' : 's'}`;
    if (count === 0) return '';
    if (allBypassed) return 'Bypassed';
    return firstGenerator ? generatorLabel(firstGenerator) : '';
  });
  const PIP_MAX = 4;

  /** Matches the flash's CSS decay; only decides whether a fire is fresh enough to mount. */
  const FLASH_MS = 220;
  function freshFire(at: number): boolean {
    return at > 0 && performance.now() - at < FLASH_MS;
  }

  const describe = $derived(
    master
      ? `${label}, ${detail}`
      : !enabled
        ? `${label}, unavailable`
        : count === 0
          ? `${label}, empty`
          : `${label}, ${count} effect${count === 1 ? '' : 's'}, ${firstName ?? ''}${allBypassed ? ', bypassed' : ''}`,
  );
</script>

<!-- Keyboard is the grid's: its roving handler turns arrows / Enter / Space on the focused cell
     into moves and selection (EffectsGrid), so the cell itself only takes pointer events. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="cell"
  class:master
  class:empty={count === 0 && !master}
  class:off={!enabled}
  class:bypassed={allBypassed}
  class:selected
  role="gridcell"
  tabindex={enabled ? (tabbable ? 0 : -1) : undefined}
  aria-label={describe}
  aria-selected={enabled ? selected : undefined}
  aria-disabled={enabled ? undefined : true}
  data-row={row}
  data-col={col}
  onclick={() => enabled && onselect?.()}
  ondblclick={() => enabled && onactivate?.()}
  onfocus={() => enabled && onfocus?.()}
  oncontextmenu={(event) => {
    if (!enabled) {
      // Disabled cells are non-interactive: no menu, not even the browser's.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    oncontextmenu?.(event);
  }}
>
  {#if enabled}
    {#if count > 0 || master}
      <span class="line">
        {#if Icon}<span class="icon" aria-hidden="true"><Icon size={14} /></span>{/if}
        <span class="name">{title}</span>
        {#if !master && count > 0}
          <span class="pips" aria-hidden="true">
            {#if count <= PIP_MAX}
              {#each { length: count }, i (i)}<span class="pip"></span>{/each}
            {:else}
              <span class="num">{count}</span>
            {/if}
          </span>
        {/if}
      </span>
      <span class="detail">
        {#if allBypassed}<PowerOff size={11} aria-hidden="true" />{/if}
        {detail}
      </span>
    {:else}
      <span class="add" aria-hidden="true"><Plus size={14} /></span>
    {/if}
    {#key fireAt}
      {#if freshFire(fireAt)}<span class="flash" aria-hidden="true"></span>{/if}
    {/key}
  {/if}
</div>

<style>
  .cell {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    height: var(--grid-cell-h, 52px);
    padding: 0 var(--space-2);
    border-radius: var(--radius-2);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    color: var(--text);
    cursor: pointer;
    user-select: none;
    outline: none;
    overflow: hidden;
  }
  /* Instant hover — no transition (house rule for grid-like surfaces). */
  .cell:hover {
    background: var(--surface-2);
  }
  .cell:focus-visible {
    box-shadow:
      inset 0 0 0 1px var(--border-strong),
      0 0 0 2px var(--accent-ring);
  }
  .cell.selected {
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .cell.selected:focus-visible {
    box-shadow:
      inset 0 0 0 1px var(--accent),
      0 0 0 2px var(--accent-ring);
  }
  /* A slot the drum doesn't have (or a zone on the Kit row): sunken, hatched, inert. */
  .cell.off {
    cursor: default;
    background:
      repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklch, var(--border-faint) 55%, transparent) 5px 6px),
      var(--surface-inset);
    box-shadow: none;
  }
  .cell.empty {
    align-items: center;
  }
  .add {
    display: inline-grid;
    color: var(--text-faint);
    opacity: 0;
  }
  .cell.empty:hover .add,
  .cell.empty:focus-visible .add,
  .cell.empty.selected .add {
    opacity: 1;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .icon {
    display: inline-grid;
    flex: none;
    color: var(--role-content);
  }
  .master .icon {
    color: var(--role-effect);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink);
  }
  .detail {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-faint);
  }
  .cell.bypassed .icon,
  .cell.bypassed .name {
    color: var(--text-faint);
  }
  .cell.bypassed .name {
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklch, var(--text-faint) 60%, transparent);
  }

  .pips {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
  }
  .pip {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--role-content);
  }
  .bypassed .pip {
    background: var(--text-faint);
  }
  .num {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--role-content);
  }

  /* FIRE — instant on, short decay; an overlay, so it never shifts layout. */
  .flash {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: color-mix(in oklch, var(--accent) 22%, transparent);
    box-shadow: inset 0 0 0 1px var(--accent);
    animation: cell-fire var(--dur-220) linear forwards;
  }
  @keyframes cell-fire {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flash {
      animation: cell-fire 220ms step-end forwards;
    }
  }
</style>
