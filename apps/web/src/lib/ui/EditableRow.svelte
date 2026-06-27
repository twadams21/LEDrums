<script lang="ts" module>
  export type { ContextMenuAction } from './ContextMenu.svelte';
</script>

<script lang="ts">
  /* Editable variant of ListItem: a selectable row that swaps to an inline rename field
     (CommitInput) and carries a right-click ContextMenu of per-row verbs. A built-in
     "Rename" verb (and double-clicking the row) enters edit mode and focuses the input;
     pass extra verbs (Duplicate, Delete=`danger`, …) via `actions` and they are appended.

     `editing` is bindable so the parent can drive edit mode externally; `onCommit(value)`
     fires once with the trimmed, changed name (CommitInput reverts blank / unchanged via
     `onCancel`). This mirrors the hand-rolled SongRail / ShowBrowser rename rows.

     Usage:
       <EditableRow icon={ListMusic} label={song.name} active={song.id === activeId}
         onclick={() => select(song.id)} onCommit={(name) => store.renameSong(song.id, name)}
         actions={[
           { label: 'Duplicate', icon: Copy, onSelect: () => store.duplicateSong(song.id) },
           { label: 'Delete', icon: Trash2, danger: true, onSelect: () => store.removeSong(song.id) },
         ]} /> */
  import type { Component } from 'svelte';
  import ListItem from './ListItem.svelte';
  import CommitInput from './CommitInput.svelte';
  import ContextMenu, { type ContextMenuAction } from './ContextMenu.svelte';
  import Pencil from '@lucide/svelte/icons/pencil';

  type Props = {
    icon?: Component;
    label: string;
    secondary?: string;
    active?: boolean;
    onclick?: (e: MouseEvent) => void;
    /** Edit-mode control — bindable so a parent can open/close it. */
    editing?: boolean;
    /** Fires with the trimmed, changed name when the rename commits. */
    onCommit: (value: string) => void;
    /** Fires when the rename is reverted (Escape / blank / unchanged). */
    onCancel?: () => void;
    /** Extra right-click verbs, appended after the built-in Rename. */
    actions?: ContextMenuAction[];
    /** aria-label / placeholder context for the rename input. */
    renameLabel?: string;
    disabled?: boolean;
    class?: string;
  };

  let {
    icon,
    label,
    secondary,
    active,
    onclick,
    editing = $bindable(false),
    onCommit,
    onCancel,
    actions,
    renameLabel = 'Rename',
    disabled = false,
    class: klass,
  }: Props = $props();

  // Defer past the context-menu's own close + focus-return, so the input we mount keeps
  // focus instead of the menu yanking it back to the (now-replaced) trigger.
  function startEditing(): void {
    requestAnimationFrame(() => (editing = true));
  }
  function commit(value: string): void {
    editing = false;
    onCommit(value);
  }
  function cancel(): void {
    editing = false;
    onCancel?.();
  }

  const menuActions = $derived<ContextMenuAction[]>([
    { label: 'Rename', icon: Pencil, onSelect: startEditing },
    ...(actions ?? []),
  ]);
</script>

{#if editing}
  <div class={['er-edit', klass]}>
    <CommitInput value={label} ariaLabel={renameLabel} onCommit={commit} onCancel={cancel} />
  </div>
{:else}
  <ContextMenu actions={menuActions} {disabled}>
    <ListItem {icon} {label} {secondary} {active} {onclick} ondblclick={startEditing} {disabled} class={klass} />
  </ContextMenu>
{/if}

<style>
  /* match the row's inner padding so the swap to the input doesn't jump */
  .er-edit {
    padding: var(--space-1) var(--space-2);
  }
</style>
