<script lang="ts" module>
  import { type Component, type Snippet } from 'svelte';

  /** One verb in a right-click menu. Flat list — no submenus/checkboxes (YAGNI). */
  export type ContextMenuAction = {
    label: string;
    icon?: Component; // optional @lucide/svelte icon
    onSelect: () => void;
    disabled?: boolean;
    danger?: boolean; // destructive styling (e.g. Delete)
  };
</script>

<script lang="ts">
  /* Project-styled right-click menu on Bits UI's ContextMenu. The menu is
     portaled to the body (sits above panels/dialogs via z-index) and opens at
     the cursor over the `children` target. Pass a flat `actions` list; each
     entry renders as one item (optional icon + label, `disabled`, `danger`).
     Selecting an action fires its `onSelect` and closes the menu; Escape /
     outside-click close it; keyboard nav is Bits UI's.

     The trigger wrapper is `display: contents`, so it does not alter the
     target's layout (works for block rows and inline chips alike).

     Usage (script): import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu.svelte';
       import Pencil from '@lucide/svelte/icons/pencil';
       import Trash2 from '@lucide/svelte/icons/trash-2';
       const actions: ContextMenuAction[] = [
         { label: 'Rename', icon: Pencil, onSelect: () => rename() },
         { label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove() },
       ];
     Usage (markup):
       <ContextMenu {actions}>
         <div class="row">Right-click me</div>
       </ContextMenu>
  */
  import { ContextMenu } from 'bits-ui';

  type Props = {
    actions: ContextMenuAction[];
    disabled?: boolean; // disable the whole trigger
    class?: string;
    children: Snippet; // the right-click target
  };

  let { actions, disabled = false, class: klass, children }: Props = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <span {...props} class={['ctx-anchor', klass]}>{@render children()}</span>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="lab-ctx-content">
      {#each actions as action (action.label)}
        <ContextMenu.Item
          class={action.danger ? 'lab-ctx-item lab-ctx-danger' : 'lab-ctx-item'}
          disabled={action.disabled}
          onSelect={() => action.onSelect()}
        >
          {#if action.icon}{@const I = action.icon}<I size={14} aria-hidden="true" />{/if}
          <span class="lab-ctx-label">{action.label}</span>
        </ContextMenu.Item>
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>

<style>
  /* transparent wrapper — never affects the target's own layout */
  .ctx-anchor {
    display: contents;
  }

  /* portaled to body — global, uniquely prefixed (mirrors .lab-sel-*). Opens
     inside Dialogs (ShowBrowser) and over panels — the topmost floating tier. */
  :global(.lab-ctx-content) {
    z-index: var(--z-tooltip);
    min-width: 10rem;
    padding: var(--space-1);
    background: var(--surface-3);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
    transform-origin: var(--bits-context-menu-content-transform-origin);
    animation: ctx-pop var(--dur-120) var(--ease-control);
  }
  @keyframes -global-ctx-pop {
    from {
      opacity: 0;
      scale: 0.97;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-ctx-content) {
      animation: none;
    }
  }
  :global(.lab-ctx-item) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    border-radius: var(--radius-1);
    cursor: pointer;
    user-select: none;
  }
  :global(.lab-ctx-label) {
    min-width: 0;
  }
  :global(.lab-ctx-item[data-highlighted]) {
    background: var(--surface-inset);
    color: var(--ink);
  }
  :global(.lab-ctx-item[data-disabled]) {
    opacity: 0.4;
    pointer-events: none;
  }

  /* destructive verbs — reuse the project's `button.danger` (--live family) */
  :global(.lab-ctx-danger) {
    color: var(--live-bright);
  }
  :global(.lab-ctx-danger[data-highlighted]) {
    background: color-mix(in oklch, var(--live) 22%, transparent);
    color: var(--live-bright);
  }
</style>
