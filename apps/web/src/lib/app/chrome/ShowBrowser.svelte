<script lang="ts">
  /* Show browser — the file menu for the show document model. A Dialog over the show
     store API: New / Save / Save As… / Close, plus a list of the saved shows you click
     to Open (the active one marked). Each row's right-click ContextMenu exposes Rename
     (inline CommitInput) + Delete. All persistence is the store's — this is pure UI over
     a tested API, no new persistence logic. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import Save from '@lucide/svelte/icons/save';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  // Save As… swaps its button for an inline name field in the action bar.
  let savingAs = $state(false);
  // The show row being renamed in place (or null).
  let renamingId = $state<string | null>(null);
  // Transient "Saved ✓" confirmation on the Save button.
  let saved = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  // Close the browser and clear every transient affordance, so a stale Save-As field,
  // rename, or saved-flash never lingers into the next open. Every close path (Escape,
  // outside-click, the X, and the navigation verbs below) routes through here.
  function dismiss(): void {
    savingAs = false;
    renamingId = null;
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

  function startRename(id: string): void {
    // Defer past the context-menu's close + focus-return so our mounted input keeps focus.
    requestAnimationFrame(() => (renamingId = id));
  }
  function commitRename(id: string, name: string): void {
    if (renamingId !== id) return; // already committed/cancelled (trailing blur)
    renamingId = null;
    store.renameShow(id, name);
  }

  function rowActions(id: string): ContextMenuAction[] {
    return [
      { label: 'Rename', icon: Pencil, onSelect: () => startRename(id) },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => store.deleteShow(id) },
    ];
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
        {#if renamingId === show.id}
          <div class="renaming">
            <CommitInput
              value={show.name}
              ariaLabel="Rename show"
              onCommit={(name) => commitRename(show.id, name)}
              onCancel={() => (renamingId = null)}
            />
          </div>
        {:else}
          <ContextMenu actions={rowActions(show.id)}>
            <button
              type="button"
              class="row"
              class:active={store.activeShowId === show.id}
              aria-pressed={store.activeShowId === show.id}
              onclick={() => openRow(show.id)}
              ondblclick={() => startRename(show.id)}
            >
              <span class="name">{show.name}</span>
              {#if store.activeShowId === show.id}
                <Check size={14} aria-hidden="true" />
                <span class="badge">active</span>
              {/if}
            </button>
          </ContextMenu>
        {/if}
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
  /* list rows read as items, not default buttons — mirror the SongRail row idiom */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: left;
  }
  .row:hover {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--text);
  }
  .row.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--ink);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  /* inline rename fills the row, matching its padding so the swap doesn't jump */
  .renaming {
    padding: var(--space-1) var(--space-2);
  }
</style>
