<script lang="ts">
  /* Confirm dialog for "Import shows from the previous version" (effect chains S06c). Lists the
     shows an import brings across, says what is kept / dropped, and runs `onImport` on confirm.
     A refused import keeps the dialog open with the reason inline (role=alert); a successful
     one closes it (the caller toasts). Built on the shared Dialog primitive (portal, focus trap,
     Esc / outside-click close). */
  import Dialog from '../../ui/Dialog.svelte';
  import type { ApplyResult } from '../../trigger-lab/effects-api';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import { IMPORT_EXPLAINER } from './LegacyImportNotice.svelte';
  import { importLabel } from './legacy-import-view';

  let {
    open,
    names,
    canImport,
    reason,
    onImport,
    onClose,
  }: {
    open: boolean;
    names: readonly string[];
    canImport: boolean;
    /** Why import is unavailable, shown in place of the confirm when `canImport` is false. */
    reason?: string;
    onImport: () => ApplyResult;
    onClose: () => void;
  } = $props();

  /** The last refusal, cleared whenever the dialog closes. */
  let error = $state<string | null>(null);

  function close(): void {
    error = null;
    onClose();
  }

  function confirm(): void {
    const result = onImport();
    if (result.ok) close();
    else error = result.reason;
  }
</script>

<Dialog {open} title="Import shows from the previous version" onClose={close} class="legacy-import-dialog">
  <div class="body" data-legacy-import-dialog>
    <h2 class="title">Import shows from the previous version</h2>
    <p class="msg">{IMPORT_EXPLAINER}</p>
    {#if names.length > 0}
      <ul class="shows" aria-label="Shows to import">
        {#each names as name, i (i)}
          <li><ListMusic size={13} aria-hidden="true" /><span>{name}</span></li>
        {/each}
      </ul>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if !canImport && reason}<p class="reason">{reason}</p>{/if}
    <div class="actions">
      <button type="button" class="ghost" onclick={close}>Cancel</button>
      <button type="button" class="primary" disabled={!canImport} onclick={confirm}>{importLabel(names.length)}</button>
    </div>
  </div>
</Dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    width: min(420px, calc(100vw - 2 * var(--space-4)));
    -webkit-font-smoothing: antialiased;
  }
  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--ink);
    text-wrap: balance;
  }
  .msg {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .shows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: var(--space-1);
    max-height: 220px;
    overflow: auto;
    list-style: none;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .shows li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }
  .shows li :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .shows li span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--live-bright);
  }
  .reason {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .actions button {
    min-height: 28px;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
  /* S06 UI convention: no click animations — opt out of the global press scale. */
  .actions button:active {
    scale: 1;
  }
</style>
