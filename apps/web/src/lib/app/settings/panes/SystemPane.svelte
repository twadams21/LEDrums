<script lang="ts">
  /* Settings › System (S4e) — the app itself, per the S4a pane spec: desktop
     updates (UpdateControl reused — the single implementation of the update flow)
     and a Backups entry opening the existing BackupsDialog. The top-bar Backups
     affordance is unaffected; this is the discoverable second door to the same
     dialog (refresh/restore stay on the dialog, viewer-gated there). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import UpdateControl from '../../chrome/UpdateControl.svelte';
  import BackupsDialog from '../../chrome/BackupsDialog.svelte';
  import History from '@lucide/svelte/icons/history';

  let { store }: { store: TriggerLab } = $props();

  let backupsOpen = $state(false);
</script>

<div class="pane-body">
  <h3>System</h3>
  <Field label="Updates" hint="desktop app">
    <UpdateControl />
  </Field>
  <Field label="Backups" hint="point-in-time snapshots">
    <button type="button" class="entry" aria-label="Browse backups" onclick={() => (backupsOpen = true)}>
      <History size={14} aria-hidden="true" />
      Browse backups
    </button>
  </Field>
</div>

<BackupsDialog {store} open={backupsOpen} onClose={() => (backupsOpen = false)} />

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  /* Entry button — the zones list's Learn-button idiom (bordered, inset, quiet). */
  .entry {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 29px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    align-self: flex-start;
  }
  .entry:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
</style>
