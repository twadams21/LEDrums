<script lang="ts">
  /* Paste-song dialog (S44). Songs paste needs a decision the other kinds don't — WHERE the song
     lands: the active show's setlist, or the shared Song Library pool. This dialog owns that
     destination choice, attempts a system-clipboard read on confirm, and reveals a manual
     paste-text field when the browser blocks clipboard reads (the portability fallback). Store
     methods do the parse/remap/toast; this is presentational + the two entry points. */
  import type { TriggerLab, SongPasteDest } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import LibraryBig from '@lucide/svelte/icons/library-big';

  let { store }: { store: TriggerLab } = $props();

  let dest = $state<SongPasteDest>('show');
  let showText = $state(false);
  let text = $state('');

  // Reset the local flow each time the dialog opens (fresh destination + no stale text).
  $effect(() => {
    if (store.songPasteOpen) {
      dest = 'show';
      showText = false;
      text = '';
    }
  });

  const DEST_OPTS = [
    { value: 'show', label: 'This show', icon: ListMusic },
    { value: 'library', label: 'Song Library', icon: LibraryBig },
  ];

  async function pasteFromClipboard(): Promise<void> {
    const result = await store.pasteSong(dest);
    if (result === 'blocked') showText = true; // reveal manual field
  }

  function pasteText(): void {
    if (!text.trim()) return;
    store.pasteSongText(dest, text);
  }
</script>

<Dialog open={store.songPasteOpen} onClose={() => store.closeSongPaste()} title="Paste song" class="paste-song">
  <header class="head"><h2>Paste song</h2></header>
  <div class="body">
    <div class="field">
      <span class="flabel">Destination</span>
      <SegmentedControl value={dest} options={DEST_OPTS} onChange={(v) => (dest = v as SongPasteDest)} ariaLabel="Paste destination" />
      <p class="hint">
        {dest === 'show'
          ? 'Adds the song to this show’s setlist, reusing any content it already has.'
          : 'Adds the song to the shared Song Library so any show can reference it.'}
      </p>
    </div>

    {#if showText}
      <div class="field">
        <span class="flabel">Paste text</span>
        <textarea
          class="paste-area"
          bind:value={text}
          placeholder="Your browser blocked clipboard access — paste the copied text here."
          rows="4"
          aria-label="Pasted song text"
        ></textarea>
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="ghost" onclick={() => store.closeSongPaste()}>Cancel</button>
      {#if showText}
        <button type="button" class="primary" disabled={!text.trim()} onclick={pasteText}>
          <ClipboardPaste size={14} aria-hidden="true" /> Paste text
        </button>
      {:else}
        <button type="button" class="primary" onclick={pasteFromClipboard}>
          <ClipboardPaste size={14} aria-hidden="true" /> Paste from clipboard
        </button>
      {/if}
    </div>
  </div>
</Dialog>

<style>
  :global(.paste-song) {
    width: min(400px, calc(100vw - 32px));
  }
  .head {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
    text-wrap: balance;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .flabel {
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: 1.4;
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .body :global(.seg) {
    width: 100%;
  }
  .paste-area {
    width: 100%;
    resize: vertical;
    padding: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.4;
    color: var(--text);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .paste-area:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 1px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .ghost,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    font-weight: 600;
    border-radius: var(--radius-2);
    transition:
      background-color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .ghost {
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px solid var(--border);
  }
  .ghost:hover {
    color: var(--text);
  }
  .primary {
    color: var(--accent-ink, var(--bg));
    background: var(--accent);
    border: 1px solid var(--accent);
  }
  .primary:hover {
    background: color-mix(in oklch, var(--accent) 88%, white);
  }
  .primary:disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .ghost:active,
  .primary:active {
    scale: 0.96;
  }
  @media (prefers-reduced-motion: reduce) {
    .ghost,
    .primary {
      transition: none;
    }
    .ghost:active,
    .primary:active {
      scale: 1;
    }
  }
</style>
