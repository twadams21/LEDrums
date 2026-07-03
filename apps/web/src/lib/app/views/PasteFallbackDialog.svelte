<script lang="ts">
  /* Paste-text fallback (S44). When a graph/section paste can't read the system clipboard (the
     browser denied access, or there's no clipboard API), the store opens this dialog so the user
     can paste the copied text by hand — clipboard portability still works without read permission.
     The store owns parse/remap/toast (`submitPasteFallback`); this is the field + two actions. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';

  let { store }: { store: TriggerLab } = $props();

  let text = $state('');
  const context = $derived(store.pasteFallback?.context ?? null);

  // Clear the field each time the dialog opens for a fresh context.
  $effect(() => {
    if (store.pasteFallback) text = '';
  });

  function submit(): void {
    if (!text.trim()) return;
    store.submitPasteFallback(text);
    text = '';
  }
</script>

<Dialog open={context !== null} onClose={() => store.cancelPasteFallback()} title="Paste text" class="paste-fallback">
  <header class="head"><h2>Paste {context ?? ''}</h2></header>
  <div class="body">
    <p class="hint">Your browser blocked clipboard access. Paste the copied {context ?? 'text'} below.</p>
    <textarea
      class="paste-area"
      bind:value={text}
      placeholder="Paste the copied text here…"
      rows="4"
      aria-label="Pasted text"
    ></textarea>
    <div class="actions">
      <button type="button" class="ghost" onclick={() => store.cancelPasteFallback()}>Cancel</button>
      <button type="button" class="primary" disabled={!text.trim()} onclick={submit}>
        <ClipboardPaste size={14} aria-hidden="true" /> Paste
      </button>
    </div>
  </div>
</Dialog>

<style>
  :global(.paste-fallback) {
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
    text-transform: capitalize;
    text-wrap: balance;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: 1.4;
    color: var(--text-faint);
    text-wrap: pretty;
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
