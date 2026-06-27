<script lang="ts">
  /* Show browser — the file menu for the show document model. A Dialog over the show
     store API: New / Save / Save As… / Close, plus a list of the saved shows you click
     to Open (the active one accent-filled). Each row is a shared `lib/ui/EditableRow`
     (inline CommitInput rename + right-click ContextMenu Delete). All persistence is the
     store's — this is pure UI over a tested API, no new persistence logic. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import Save from '@lucide/svelte/icons/save';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  // Save As… swaps its button for an inline name field in the action bar.
  let savingAs = $state(false);
  // Transient "Saved ✓" confirmation on the Save button.
  let saved = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  // Close the browser and clear every transient affordance, so a stale Save-As field or
  // saved-flash never lingers into the next open. Every close path (Escape, outside-click,
  // the X, and the navigation verbs below) routes through here. Row renames live inside
  // each EditableRow, so they reset on unmount when the dialog closes.
  function dismiss(): void {
    savingAs = false;
    saved = false;
    if (savedTimer) clearTimeout(savedTimer);
    onClose();
  }

  // Navigation verbs (anything that changes which show is active) dismiss the browser so
  // you land back in the workspace on the chosen show. Save / Delete stay open.
  function createShow(): void {
    store.newShow();
    dismiss();
  }
  function save(): void {
    store.saveShow();
    saved = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved = false), 1400);
  }
  function commitSaveAs(name: string): void {
    store.saveShowAs(name);
    dismiss();
  }
  function closeShow(): void {
    store.closeShow();
    dismiss();
  }
  function openRow(id: string): void {
    if (id !== store.activeShowId) store.openShow(id);
    dismiss();
  }

  function rowActions(id: string): ContextMenuAction[] {
    return [{ label: 'Delete', icon: Trash2, danger: true, onSelect: () => store.deleteShow(id) }];
  }
</script>

<Dialog {open} onClose={dismiss} title="Shows" class="dlg-shows">
  <header class="shead">
    <Eyebrow icon={ListMusic}>Shows</Eyebrow>
    <span class="spacer"></span>
    <IconButton icon={X} label="Close" onclick={dismiss} />
  </header>

  <div class="actions">
    <button type="button" onclick={createShow}><FilePlus size={14} aria-hidden="true" />New</button>
    <button type="button" class:saved onclick={save}>
      {#if saved}<Check size={14} aria-hidden="true" />Saved{:else}<Save size={14} aria-hidden="true" />Save{/if}
    </button>
    {#if savingAs}
      <span class="saveas">
        <CommitInput
          value={store.activeShow?.name ?? ''}
          placeholder="Save as…"
          ariaLabel="New show name"
          onCommit={(name) => commitSaveAs(name)}
          onCancel={() => (savingAs = false)}
        />
      </span>
    {:else}
      <button type="button" onclick={() => (savingAs = true)}>Save As…</button>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="ghost" onclick={closeShow}>Close show</button>
  </div>

  <ul class="list">
    {#each store.shows as show (show.id)}
      <li>
        <EditableRow
          label={show.name}
          active={store.activeShowId === show.id}
          renameLabel="Rename show"
          onclick={() => openRow(show.id)}
          onCommit={(name) => store.renameShow(show.id, name)}
          actions={rowActions(show.id)}
        />
      </li>
    {/each}
  </ul>
</Dialog>

<style>
  :global(.dlg-shows) {
    width: min(440px, 92vw);
  }
  .shead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .spacer {
    flex: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .actions button.saved {
    color: var(--ink);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
  }
  .saveas {
    display: block;
    width: 150px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: auto;
  }
</style>
