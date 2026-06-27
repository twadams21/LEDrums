<script lang="ts">
  /* Selectable list row — the single most-repeated chrome pattern (LeftRail `.navitem`,
     SongRail `.item`, ShowBrowser `.row`, Sections / Objects). A flex row of an optional
     icon + a label/secondary block, with an optional hover-revealed `actions` slot on the
     trailing edge. Encapsulates the shared active / hover token styling so adoption is
     visually identical: transparent until hover (`--surface-2`), `--accent-soft` fill +
     `--accent` border when `active`. Square corners per `--radius-card`.

     The clickable area is the inner button (so `actions` may contain its own buttons
     without nesting interactive elements). `onclick` selects the row; `ondblclick` is
     forwarded for composers that start an inline edit on double-click (see EditableRow).

     Usage:
       <ListItem icon={ListMusic} label={song.name} secondary={`${count} sections`}
         active={song.id === activeId} onclick={() => select(song.id)}>
         {#snippet actions()}
           <IconButton icon={Trash2} label="Delete" onclick={() => remove(song.id)} />
         {/snippet}
       </ListItem> */
  import type { Component, Snippet } from 'svelte';

  type Props = {
    /** Optional leading @lucide/svelte icon. */
    icon?: Component;
    label: string;
    /** Sub-label stacked under `label`. */
    secondary?: string;
    /** Selected state — drives the accent fill/border and `aria-pressed`. */
    active?: boolean;
    onclick?: (e: MouseEvent) => void;
    /** Forwarded to the row button — composers use it to start an inline edit. */
    ondblclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    /** Trailing actions, revealed on row hover / focus-within. */
    actions?: Snippet;
    /** Always-visible trailing content (status/indicator dots), before `actions`. */
    trailing?: Snippet;
    class?: string;
  };

  let {
    icon: Icon,
    label,
    secondary,
    active,
    onclick,
    ondblclick,
    disabled = false,
    actions,
    trailing,
    class: klass,
  }: Props = $props();
</script>

<div class={['li', klass]} class:active class:disabled>
  <button
    class="li-main"
    type="button"
    {disabled}
    aria-pressed={active}
    {onclick}
    {ondblclick}
  >
    {#if Icon}<Icon size={16} aria-hidden="true" />{/if}
    <span class="labels">
      <span class="lab">{label}</span>
      {#if secondary}<span class="sub">{secondary}</span>{/if}
    </span>
  </button>
  {#if trailing}
    <span class="li-trailing">{@render trailing()}</span>
  {/if}
  {#if actions}
    <span class="li-actions">{@render actions()}</span>
  {/if}
</div>

<style>
  .li {
    display: flex;
    align-items: center;
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-card);
    color: var(--text-muted);
  }
  .li:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .li.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  .li.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .li-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
  }
  .li-main :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .li.active .li-main :global(svg) {
    color: var(--accent);
  }

  .labels {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    min-width: 0;
  }
  .lab {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  /* always-visible trailing indicators (status dots), pushed to the trailing edge */
  .li-trailing {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
    margin-inline-start: auto;
    padding-inline-end: var(--space-2);
  }
  /* when both are present the trailing block owns the auto margin; actions sit after it */
  .li-trailing + .li-actions {
    margin-inline-start: 0;
  }

  /* trailing actions — hidden until the row is hovered or holds focus */
  .li-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-inline-start: auto;
    padding-inline-end: var(--space-2);
    opacity: 0;
    transition: opacity var(--dur-120) ease;
  }
  .li:hover .li-actions,
  .li:focus-within .li-actions {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .li-actions {
      transition: none;
    }
  }
</style>
