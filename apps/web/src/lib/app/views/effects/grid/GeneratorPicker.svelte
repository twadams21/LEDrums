<script lang="ts">
  /* The Generator picker — the first step of adding an Effect to a cell. A small menu anchored to
     the cell (fixed, viewport px): flip above when there is no room below, clamp to the viewport.
     One click (or Enter) picks; Esc or a click outside closes. It marks itself an open popup
     (`data-keyboard-owner="popover"`) so the app's digit keys yield to it while it is open. */
  import { onMount } from 'svelte';
  import type { effectChain } from '@ledrums/core';
  import { generatorChoices } from './generator-icons';

  type Props = {
    /** The cell's viewport rect; the menu opens under (or over) it. */
    anchor: { left: number; top: number; bottom: number };
    /** Accessible name, e.g. "Add Effect to Kick head". */
    label: string;
    onpick: (kind: effectChain.GeneratorKind) => void;
    onclose: () => void;
  };

  let { anchor, label, onpick, onclose }: Props = $props();

  const choices = generatorChoices();
  const W = 272;
  const GAP = 4;
  const MARGIN = 8;

  let menu = $state<HTMLElement | null>(null);
  let height = $state(0);
  const pos = $derived.by(() => {
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
    const below = anchor.bottom + GAP;
    const fitsBelow = below + height <= vh - MARGIN;
    const top = fitsBelow ? below : Math.max(MARGIN, anchor.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, anchor.left), vw - W - MARGIN);
    return { top, left };
  });

  const items = (): HTMLButtonElement[] => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  onMount(() => {
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent): void => {
      if (menu && !event.composedPath().includes(menu)) onclose();
    };
    // Capture: a click on another cell must close this menu before it selects that cell.
    window.addEventListener('pointerdown', outside, true);
    // Anchored in viewport px: a scroll of anything but the menu itself would detach it from its cell.
    const scrolled = (event: Event): void => {
      if (!(event.target instanceof Node && menu?.contains(event.target))) onclose();
    };
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
    };
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home' ? 0
      : event.key === 'End' ? list.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }
</script>

<div
  class="picker"
  bind:this={menu}
  bind:clientHeight={height}
  role="menu"
  tabindex="-1"
  aria-label={label}
  data-keyboard-owner="popover"
  data-keyboard-open="true"
  style:top={`${pos.top}px`}
  style:left={`${pos.left}px`}
  style:width={`${W}px`}
  {onkeydown}
>
  <p class="head">Generator</p>
  {#each choices as choice (choice.kind)}
    <button type="button" class="item" role="menuitem" onclick={() => onpick(choice.kind)}>
      <span class="icon" aria-hidden="true"><choice.icon size={15} /></span>
      <span class="text">
        <span class="label">{choice.label}</span>
        <span class="desc">{choice.description}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .picker {
    position: fixed;
    z-index: var(--z-tooltip);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
    outline: none;
    animation: picker-pop var(--dur-120) var(--ease-control);
  }
  @keyframes picker-pop {
    from {
      opacity: 0;
      translate: 0 -2px;
    }
  }
  .head {
    margin: 0;
    padding: var(--space-1) var(--space-2) 6px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 36px;
    padding: 4px var(--space-2);
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    outline: none;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--surface-inset);
    color: var(--ink);
  }
  .icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-1);
    background: color-mix(in oklch, var(--role-content) 14%, transparent);
    color: var(--role-content);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: inherit;
  }
  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
