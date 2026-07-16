<script lang="ts">
  /* Backups dialog (#123) — the panic button for a drummer whose project just corrupted before a
     gig. A Dialog over the store's backup API: a newest-first list of point-in-time snapshots
     (relative time + why it was taken), each with a Restore action gated behind one confirm. All
     persistence + restore is the server's (via the store) — this is pure UI over a tested API,
     mirroring ShowBrowser. Restore is editor-only; a viewer sees the list read-only. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { BackupReason } from '../../ws/protocol-types';
  import Dialog from '../../ui/Dialog.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import History from '@lucide/svelte/icons/history';
  import Power from '@lucide/svelte/icons/power';
  import Clock from '@lucide/svelte/icons/clock';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import type { Component } from 'svelte';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  // The snapshot pending restore-confirmation (null = confirm closed).
  let confirmingId = $state<string | null>(null);
  // A live "now" so relative times stay honest while the dialog sits open — ticked every 20s.
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;

  // On open: pull the latest listing and start the relative-time ticker; on close, stop it. The
  // list arrives asynchronously on the `backups` message and lands in store.backups.
  $effect(() => {
    if (open) {
      now = Date.now();
      store.refreshBackups();
      tick = setInterval(() => (now = Date.now()), 20_000);
      return () => {
        if (tick) clearInterval(tick);
        tick = null;
      };
    }
  });

  const REASONS: Record<BackupReason, { label: string; icon: Component }> = {
    boot: { label: 'Session start', icon: Power },
    cadence: { label: 'Auto-saved', icon: Clock },
    'pre-risk': { label: 'Before a big change', icon: ShieldAlert },
  };

  /** Compact relative time — "just now", "5m ago", "3h ago", "2d ago". */
  function relativeTime(ms: number): string {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function dismiss(): void {
    confirmingId = null;
    onClose();
  }
  function confirmRestore(): void {
    if (confirmingId) store.restoreBackup(confirmingId);
    dismiss();
  }
</script>

<Dialog {open} onClose={dismiss} title="Backups" class="dlg-backups">
  <header class="bhead">
    <Eyebrow icon={History}>Backups</Eyebrow>
    <span class="spacer"></span>
    <IconButton icon={X} label="Close" onclick={dismiss} />
  </header>

  {#if store.backups.length === 0}
    <p class="empty">No backups yet. One is taken automatically on launch, periodically, and before
      any risky change.</p>
  {:else}
    <ul class="list">
      {#each store.backups as snap (snap.id)}
        <li>
          <ListItem
            icon={REASONS[snap.reason].icon}
            label={relativeTime(snap.createdAt)}
            secondary={REASONS[snap.reason].label}
          >
            {#snippet actions()}
              <IconButton
                icon={RotateCcw}
                label="Restore this backup"
                disabled={store.isViewer}
                onclick={() => (confirmingId = snap.id)}
              />
            {/snippet}
          </ListItem>
        </li>
      {/each}
    </ul>
    {#if store.isViewer}
      <p class="hint">You're viewing — only the editor can restore a backup.</p>
    {/if}
  {/if}
</Dialog>

<ConfirmDialog
  open={confirmingId !== null}
  danger
  title="Restore this backup?"
  message="A backup of your current state is taken first, then your project, shows and songs are replaced with this snapshot and every connected screen reloads."
  confirmLabel="Restore"
  onConfirm={confirmRestore}
  onClose={() => (confirmingId = null)}
/>

<style>
  :global(.dlg-backups) {
    width: min(420px, 92vw);
  }
  .bhead {
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
  .list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: min(420px, 60vh);
    min-height: 0;
    overflow: auto;
  }
  .empty {
    margin: 0;
    padding: var(--space-5) var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .hint {
    margin: 0;
    padding: 0 var(--space-4) var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
