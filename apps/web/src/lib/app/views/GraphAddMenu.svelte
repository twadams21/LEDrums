<script lang="ts">
  /* One add-node palette button that opens a modal type-picker (replaces the always-expanded
     ModifierPalette / modulation palette that blocked the canvas). The button matches the
     GraphPalette button look exactly; the modal is the shared design-system Dialog. Registry-
     or list-driven `groups`: a single group renders a flat grid; several groups render a
     SegmentedControl category filter above the grid (the modifier case). On select it computes
     the visible canvas centre from the flow instance — exactly like GraphPalette — and hands
     `(id, cx, cy)` to `add`, then closes.

     A child of <SvelteFlow> (rendered in the palette snippet), so `useSvelteFlow()` reaches the
     live instance; the Dialog itself portals to <body> but stays in the flow's component tree,
     so the context still resolves. */
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';

  export type PickerItem = {
    id: string;
    name: string;
    icon: Component;
    /** CSS colour for the item's icon (falls back to the role-mod tint). */
    tint?: string;
    /** Optional one-line description under the name. */
    hint?: string;
  };
  export type PickerGroup = {
    /** Filter value + heading. A single group hides the filter and the heading. */
    category: string;
    label: string;
    items: PickerItem[];
  };

  let {
    label,
    icon,
    title,
    subtitle,
    groups,
    add,
    disabled = false,
    tint = 'var(--role-mod)',
  }: {
    /** Button + modal-title noun, e.g. "Modifier" → button "Add Modifier", title "Add modifier". */
    label: string;
    icon: Component;
    /** Modal title; defaults to `Add {label}`. */
    title?: string;
    /** Optional sub line under the modal title. */
    subtitle?: string;
    groups: ReadonlyArray<PickerGroup>;
    /** Place the picked item — `cx`/`cy` are the flow-space centre of the visible canvas. */
    add: (id: string, cx: number, cy: number) => void;
    disabled?: boolean;
    /** Button icon tint (matches the palette kind tints). */
    tint?: string;
  } = $props();

  const flow = useSvelteFlow();

  let open = $state(false);
  let filter = $state<string>('all');
  /** The trigger button — its `.svelte-flow` ancestor anchors the drop centre (the modal itself
      portals to <body>, so we can't measure from inside it). */
  let btnEl = $state<HTMLButtonElement | null>(null);

  // Only offer the category filter when there is more than one group to switch between.
  const filterable = $derived(groups.length > 1);
  const segments = $derived([
    { value: 'all', label: 'All' },
    ...groups.map((g) => ({ value: g.category, label: g.label })),
  ]);
  // The EFFECTIVE filter — a `$derived`, never a self-referential `$effect` (AGENTS rule): if the
  // selected category disappears (registry change), it reads as 'all' without mutating `filter`.
  const activeFilter = $derived(
    filter === 'all' || groups.some((g) => g.category === filter) ? filter : 'all',
  );
  const visible = $derived(
    activeFilter === 'all' ? groups : groups.filter((g) => g.category === activeFilter),
  );
  const ButtonIcon = $derived(icon);

  function openPicker(): void {
    filter = 'all';
    open = true;
  }

  /** Flow-space centre of the visible canvas (falls back to the origin off-screen). */
  function pick(id: string): void {
    // Anchor the centre on THIS button's flow surface (not a global lookup), so a second graph
    // canvas on the page can't steal the measurement.
    const surface = btnEl?.closest('.svelte-flow');
    const r = surface?.getBoundingClientRect();
    const c = flow.screenToFlowPosition(
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 },
    );
    add(id, c.x, c.y);
    open = false;
  }
</script>

<button
  bind:this={btnEl}
  class="palette-btn"
  onclick={openPicker}
  title={title ?? `Add ${label}`}
  {disabled}
  style="--tint:{tint}"
>
  <ButtonIcon size={14} aria-hidden="true" class="palette-ico" />
  {label}
</button>

<Dialog {open} onClose={() => (open = false)} title={title ?? `Add ${label}`} class="graph-add-dialog">
  <header class="head">
    <span class="badge" style="--tint:{tint}"><ButtonIcon size={16} aria-hidden="true" /></span>
    <div class="head-text">
      <h2>{title ?? `Add ${label}`}</h2>
      {#if subtitle}<p class="sub">{subtitle}</p>{/if}
    </div>
  </header>

  {#if filterable}
    <div class="filter">
      <SegmentedControl
        value={activeFilter}
        options={segments}
        onChange={(v) => (filter = v)}
        ariaLabel="Filter {label} by category"
      />
    </div>
  {/if}

  <div class="groups">
    {#each visible as group (group.category)}
      <section class="group">
        {#if filterable && activeFilter === 'all'}<h3 class="cat">{group.label}</h3>{/if}
        <div class="grid">
          {#each group.items as item (item.id)}
            {@const I = item.icon}
            <button class="pick" onclick={() => pick(item.id)} title={`Add ${item.name}`}>
              <span class="pick-ico" style="--tint:{item.tint ?? tint}"
                ><I size={16} aria-hidden="true" /></span
              >
              <span class="pick-text">
                <span class="pick-name">{item.name}</span>
                {#if item.hint}<span class="pick-hint">{item.hint}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</Dialog>

<style>
  /* Matches GraphPalette's `.palette-btn` exactly (the two graphs share the look; the codebase
     keeps a copy per palette component). */
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    cursor: pointer;
    /* re-enable events on the button (the enclosing palette bar is pointer-events:none) */
    pointer-events: auto;
    transition-property: border-color, color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .palette-btn:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .palette-btn:active:not(:disabled) {
    scale: 0.96;
  }
  .palette-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .palette-btn :global(.palette-ico) {
    color: var(--tint);
    flex: none;
  }

  /* --- modal ---------------------------------------------------------------- */
  :global(.graph-add-dialog) {
    width: min(420px, calc(100vw - 32px));
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    color: var(--tint);
  }
  .head-text {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
    text-wrap: balance;
  }
  .sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .filter {
    padding: var(--space-3) var(--space-3) 0;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    overflow-y: auto;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .cat {
    margin: 0;
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--role-mod);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-2);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    text-align: left;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    cursor: pointer;
    transition-property: border-color, background-color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .pick:hover {
    border-color: var(--border-strong);
    background: var(--surface);
  }
  .pick:active {
    scale: 0.97;
  }
  .pick-ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-1);
    background: color-mix(in oklch, var(--tint) 14%, transparent);
    color: var(--tint);
  }
  .pick-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .pick-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pick-hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-reduced-motion: reduce) {
    .palette-btn,
    .pick {
      transition: none;
    }
  }
</style>
