<script lang="ts">
  /* The device-panel shell every card in this folder sits in — Ableton's Device View panel:
     a fixed-width, fixed-height column with a title bar (power toggle · role icon · name ·
     actions · fold) and the controls laid out on the face below.

     Role colour marks the device family (generator / modifier / control) on a 2px top rule and
     the title icon; it never fills the panel, so the only saturated colour at rest is the
     light itself (PRODUCT.md "show the color"). Folded, the panel collapses to a narrow column
     with its name running vertically, as Live folds a device.

     Interaction contract (S06 UI conventions): instant hover, no lift, no press animation. */
  import type { Component, Snippet } from 'svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import { mappable } from '../../../../map-mode/mappable.svelte';
  import Power from '@lucide/svelte/icons/power';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  type Role = 'generator' | 'modifier' | 'control';

  interface Props {
    role: Role;
    icon: Component;
    /** The device's name (title bar). */
    title: string;
    /** A short family label under the title ("Generator", "Modifier · Temporal"). */
    eyebrow?: string;
    /** Present → the card shows a power (bypass) toggle; `on` = not bypassed. `map` makes the
        toggle MIDI-mappable (its bypass target). */
    power?: { on: boolean; onToggle: (on: boolean) => void; map?: MappableSpec };
    /** Viewer / read-only song: the power toggle is inert (controls handle their own). */
    disabled?: boolean;
    /** Panel width in px (the chain scrolls; cards never squeeze). */
    width?: number;
    /** Start folded (the fold is view state, local to the card). */
    initiallyFolded?: boolean;
    /** Extra title-bar controls (a menu, a save button). */
    actions?: Snippet;
    /** Highlighted in the strip — the thing Delete / ⌘X / ⌘C act on. */
    selected?: boolean;
    /** A press anywhere on the card highlights it (see `selected`). */
    onSelect?: () => void;
    children: Snippet;
    class?: string;
  }

  let {
    role,
    icon: Icon,
    title,
    eyebrow,
    power,
    disabled = false,
    width = 248,
    initiallyFolded = false,
    actions,
    selected = false,
    onSelect,
    children,
    class: klass,
  }: Props = $props();

  // View-only state the card owns: whether it is folded. Not authored, not undoable.
  // svelte-ignore state_referenced_locally
  let folded = $state(initiallyFolded);
  const bypassed = $derived(power ? !power.on : false);
</script>

<!-- A press anywhere on the card highlights it — in the CAPTURE phase, so a control that stops
     its own pointer events (a face-param drag) still selects the card it sits on. Selecting never
     moves focus: the control keeps it. -->
<section
  class={['card', `role-${role}`, klass]}
  class:folded
  class:bypassed
  class:selected
  onpointerdowncapture={() => onSelect?.()}
  style:--card-w={`${width}px`}
  aria-label={`${eyebrow ? `${eyebrow}: ` : ''}${title}`}
>
  <header class="bar">
    {#if power}
      <Tooltip text={power.on ? `Bypass ${title}` : `Turn ${title} on`}>
        <button
          type="button"
          class="power"
          class:on={power.on}
          aria-pressed={power.on}
          aria-label={`${title} on`}
          {disabled}
          {@attach power.map && mappable(power.map)}
          onclick={() => power.onToggle(!power.on)}
        >
          <Power size={13} aria-hidden="true" />
        </button>
      </Tooltip>
    {/if}
    {#if !folded}
      <span class="ricon" aria-hidden="true"><Icon size={14} /></span>
      <span class="titles">
        <span class="title" title={title}>{title}</span>
        {#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
      </span>
      {#if actions}<span class="actions">{@render actions()}</span>{/if}
    {/if}
    <Tooltip text={folded ? `Unfold ${title}` : `Fold ${title}`}>
      <button
        type="button"
        class="fold"
        aria-expanded={!folded}
        aria-label={folded ? `Unfold ${title}` : `Fold ${title}`}
        onclick={() => (folded = !folded)}
      >
        {#if folded}<ChevronRight size={14} aria-hidden="true" />{:else}<ChevronLeft size={14} aria-hidden="true" />{/if}
      </button>
    </Tooltip>
  </header>

  {#if folded}
    <button type="button" class="spine" onclick={() => (folded = false)} aria-label={`Unfold ${title}`}>
      <span class="ricon" aria-hidden="true"><Icon size={14} /></span>
      <span class="spinetitle">{title}</span>
    </button>
  {:else}
    <div class="face">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .card {
    --role: var(--role-content);
    display: flex;
    flex-direction: column;
    flex: none;
    width: var(--card-w);
    height: 100%;
    min-height: 0;
    background: var(--surface-2);
    border-radius: var(--radius-card);
    /* role rule on top + a faint hairline around: shadows, not borders, so the panel sits on
       any strip background */
    box-shadow:
      inset 0 2px 0 0 var(--role),
      inset 0 0 0 1px var(--border-faint);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  /* Highlighted: an accent ring inside the edge (the scrolling chain would clip one outside),
     keeping the role rule on top. */
  .card.selected {
    box-shadow:
      inset 0 2px 0 0 var(--role),
      inset 0 0 0 2px var(--accent);
  }
  .role-generator { --role: var(--role-content); }
  .role-modifier { --role: var(--role-effect); }
  .role-control { --role: var(--role-mod); }

  .card.folded {
    width: 36px;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    flex: none;
    height: 36px;
    padding: 2px var(--space-1) 0 var(--space-1_5);
    background: var(--surface-3);
    box-shadow: inset 0 -1px 0 0 var(--border-faint);
  }
  .card.folded .bar {
    flex-direction: column;
    justify-content: center;
    padding: 2px 0 0;
  }

  .ricon {
    display: inline-flex;
    flex: none;
    color: var(--role);
    line-height: 0;
  }
  .titles {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    line-height: 1.15;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
  }
  .eyebrow {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 2px;
  }

  .power,
  .fold {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    line-height: 0;
  }
  /* instant hover — no transition (S06 UI conventions) */
  .power:hover,
  .fold:hover {
    background: var(--surface-inset);
    color: var(--ink);
  }
  .power.on {
    color: var(--role);
  }
  .power:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .power:focus-visible,
  .fold:focus-visible,
  .spine:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }

  .face {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  /* A bypassed device still edits — it just reads as out of the signal path. */
  .card.bypassed .face {
    opacity: 0.55;
  }
  .card.bypassed .title {
    color: var(--text-muted);
  }

  .spine {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    padding: var(--space-2) 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .spine:hover {
    background: var(--surface-3);
    color: var(--ink);
  }
  .spinetitle {
    writing-mode: vertical-rl;
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
