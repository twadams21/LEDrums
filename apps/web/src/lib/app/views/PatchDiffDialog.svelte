<script lang="ts">
  /* Patch paste confirm (group K / S45). A pasted `patch` ClipDoc re-rigs the physical device
     WHOLESALE (kit incl. outputs, input map, output settings) via the bulk `setProject` message —
     so the change is explicit, never silent: this dialog diffs the incoming patch against the live
     rig (drum count, pixel totals, output host, protocol) and requires a deliberate "Apply patch"
     before the store sends. Patch-specific by design (S44 owns the generic authored-kinds paste),
     composed from the design system's Dialog + tokens. */
  import Dialog from '../../ui/Dialog.svelte';
  import type { PatchDiff } from '../../trigger-lab/patch-diff';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';

  let {
    open,
    diff,
    onConfirm,
    onClose,
  }: { open: boolean; diff: PatchDiff | null; onConfirm: () => void; onClose: () => void } = $props();
</script>

<Dialog {open} {onClose} title="Paste patch" class="patch-diff-dialog">
  <header class="head">
    <span class="badge"><ClipboardPaste size={15} aria-hidden="true" /></span>
    <div class="head-text">
      <h2>Paste patch{#if diff?.name}<span class="pname"> · {diff.name}</span>{/if}</h2>
      <p class="sub">Re-rigs the device — kit, inputs & output. Authored songs are left untouched.</p>
    </div>
  </header>

  {#if diff}
    <ul class="rows">
      {#each diff.rows as row (row.key)}
        <li class="row" class:changed={row.changed}>
          <span class="rlabel">{row.label}</span>
          <span class="rvals">
            <span class="from">{row.from}</span>
            <ArrowRight size={13} aria-hidden="true" class="arrow" />
            <span class="to">{row.to}</span>
          </span>
        </li>
      {/each}
    </ul>
    {#if !diff.hasChanges}
      <p class="nochange">This patch matches the current rig — nothing will change.</p>
    {/if}
  {/if}

  <footer class="foot">
    <button type="button" class="btn ghost" onclick={onClose}>Cancel</button>
    <button type="button" class="btn primary" onclick={onConfirm}>Apply patch</button>
  </footer>
</Dialog>

<style>
  :global(.patch-diff-dialog) {
    width: min(400px, calc(100vw - 32px));
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    color: var(--accent-bright);
  }
  .head-text {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
    text-wrap: balance;
  }
  .pname {
    color: var(--text-muted);
    font-weight: 600;
  }
  .sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    transition-property: border-color, background-color;
    transition-duration: var(--dur-150);
  }
  .row.changed {
    border-color: var(--border-strong);
    background: var(--surface);
  }
  .rlabel {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .row.changed .rlabel {
    color: var(--text);
  }
  .rvals {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .from {
    color: var(--text-faint);
  }
  .rvals :global(.arrow) {
    color: var(--text-faint);
  }
  .to {
    color: var(--text-muted);
    font-weight: 600;
  }
  .row.changed .to {
    color: var(--accent-bright);
  }
  .nochange {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .btn {
    height: 30px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    font-weight: 600;
    transition-property: background-color, border-color, color, scale, filter;
    transition-duration: var(--dur-120);
  }
  .btn:active {
    scale: 0.96;
  }
  .ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .ghost:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .primary {
    background: var(--accent);
    border: 1px solid var(--accent-bright);
    color: var(--on-accent);
  }
  .primary:hover {
    filter: brightness(1.06);
  }
</style>
