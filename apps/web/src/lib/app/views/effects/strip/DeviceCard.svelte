<script lang="ts">
  /* The device-panel shell every card in the strip shares (Ableton Device View): a fixed-height
     panel with a title bar — optional power (bypass) toggle, role-tinted icon, name, trailing
     controls, fold toggle — and a face that holds every param. Folded, the panel collapses to a
     narrow spine with the name running vertically, so a long chain can be skimmed.

     The fold is view state owned here (never authored, never undone). The role tint arrives as
     a CSS colour (a `--role-*` token) and only touches the icon, the top rule and the power
     glyph — the face stays neutral so params read the same on every card. */
  import { untrack, type Component, type Snippet } from 'svelte';
  import Power from '@lucide/svelte/icons/power';
  import ChevronsLeftRight from '@lucide/svelte/icons/chevrons-left-right';
  import ChevronsRightLeft from '@lucide/svelte/icons/chevrons-right-left';
  import Tooltip from '../../../../ui/Tooltip.svelte';

  type Props = {
    title: string;
    /** Role colour, e.g. `var(--role-input)`. */
    tint: string;
    icon?: Component;
    /** Face width in px (the fold spine ignores it). */
    width?: number;
    /** Present → the title bar carries a power toggle; `on` = not bypassed. */
    power?: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean };
    /** Start folded. */
    folded?: boolean;
    /** Dim the face (a bypassed device or Effect). */
    dimmed?: boolean;
    /** Trailing title-bar controls (menus, audition). */
    actions?: Snippet;
    children: Snippet;
    class?: string;
  };

  let {
    title,
    tint,
    icon: Icon,
    width = 232,
    power,
    folded: startFolded = false,
    dimmed = false,
    actions,
    children,
    class: klass,
  }: Props = $props();

  // The prop only seeds the fold; the card owns it after.
  let folded = $state(untrack(() => startFolded));
</script>

<section
  class={['device', klass]}
  class:folded
  class:dimmed
  style:--tint={tint}
  style:--device-w={folded ? undefined : `${width}px`}
  aria-label={title}
>
  <header class="bar">
    {#if power}
      <Tooltip text={power.on ? `Bypass ${title}` : `Enable ${title}`}>
        <button
          type="button"
          class="power"
          class:on={power.on}
          aria-pressed={power.on}
          aria-label={`${title} on`}
          disabled={power.disabled}
          onclick={() => power.onChange(!power.on)}
        >
          <Power size={13} aria-hidden="true" />
        </button>
      </Tooltip>
    {/if}
    {#if Icon && !folded}<Icon size={14} class="icon" aria-hidden="true" />{/if}
    <h3 class="name" title={title}>{title}</h3>
    {#if actions && !folded}<span class="actions">{@render actions()}</span>{/if}
    <Tooltip text={folded ? `Unfold ${title}` : `Fold ${title}`}>
      <button
        type="button"
        class="fold"
        aria-expanded={!folded}
        aria-label={folded ? `Unfold ${title}` : `Fold ${title}`}
        onclick={() => (folded = !folded)}
      >
        {#if folded}
          <ChevronsLeftRight size={13} aria-hidden="true" />
        {:else}
          <ChevronsRightLeft size={13} aria-hidden="true" />
        {/if}
      </button>
    </Tooltip>
  </header>
  {#if !folded}
    <div class="face">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .device {
    display: flex;
    flex-direction: column;
    flex: none;
    width: var(--device-w, 232px);
    height: var(--device-h, 240px);
    min-width: 0;
    background: var(--surface-2);
    border-radius: var(--radius-card);
    box-shadow:
      inset 0 2px 0 0 color-mix(in oklch, var(--tint) 70%, transparent),
      0 0 0 1px var(--border-faint);
  }
  .device.folded {
    width: 32px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    height: 32px;
    padding: 2px var(--space-1) 0 var(--space-2);
    flex: none;
    min-width: 0;
    border-bottom: 1px solid var(--border-faint);
  }
  .folded .bar {
    flex-direction: column;
    height: 100%;
    padding: var(--space-2) 0;
    border-bottom: 0;
  }
  .bar :global(.icon) {
    flex: none;
    color: var(--tint);
  }
  .name {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--ink);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .folded .name {
    order: 2;
    writing-mode: vertical-rl;
    rotate: 180deg;
    color: var(--text-muted);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .power,
  .fold {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    padding: 0;
    color: var(--text-faint);
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  /* 40px hit area without growing the dense bar. */
  .power::after,
  .fold::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .power:hover,
  .fold:hover {
    color: var(--ink);
    background: var(--surface-3);
  }
  .power.on {
    color: var(--tint);
  }
  .power:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .folded .fold {
    order: 1;
  }
  .face {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    scrollbar-width: thin;
  }
  .dimmed .face {
    opacity: 0.5;
  }
</style>
