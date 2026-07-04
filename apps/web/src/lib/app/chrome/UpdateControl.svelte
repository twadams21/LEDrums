<script lang="ts">
  /* The desktop update flow, in one place (S07). Reads live boot/update state from the
     desktop-bridge and drives the whole cycle: check → available → install (with a real
     progress bar streamed from Rust) → restart. This is the single implementation of the
     flow — the settings dialog embeds it, and the top-bar badge merely opens that dialog,
     so the flow is identical wherever it is reached.

     Install ONLY ever runs from a user action here; the app restarts itself once the
     download completes (never auto-restart from the web). In a plain browser (no desktop
     host) it degrades to a muted note. */
  import { onMount } from 'svelte';
  import { desktopBridge, type DesktopBridge } from '../desktop-bridge.svelte';

  let { bridge = desktopBridge }: { bridge?: DesktopBridge } = $props();

  // Idempotent: safe even though S08 also starts the bridge at the app root. The badge/dialog
  // need live boot state whenever they mount, so we ensure it here rather than depend on ordering.
  onMount(() => {
    void bridge.start();
  });

  const status = $derived(bridge.bootStatus);
  const updating = $derived(status.stage === 'updating');
  const available = $derived(status.updateAvailable);
  const pct = $derived(status.progressPct);

  let checking = $state(false);
  let note = $state('');

  async function check(): Promise<void> {
    checking = true;
    note = 'Checking…';
    const result = await bridge.checkForUpdate();
    checking = false;
    if (!result) {
      note = 'Update management is available in the desktop app.';
      return;
    }
    if (result.error) {
      note = `Could not check for updates: ${result.error}`;
      return;
    }
    // When available, the availability block below takes over — clear the transient note.
    note = result.available ? '' : 'You’re up to date.';
  }

  async function install(): Promise<void> {
    note = '';
    const started = await bridge.installUpdate();
    // On success Rust streams progress into bootStatus and restarts when done; nothing else to do.
    if (!started) note = 'Could not start the update.';
  }
</script>

<div class="update">
  {#if !bridge.isDesktop}
    <p class="muted">Update management is available in the desktop app.</p>
  {:else if updating}
    <div class="downloading">
      <div class="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Update download progress">
        <div class="fill" class:indeterminate={pct == null} style:width={pct != null ? `${pct}%` : undefined}></div>
      </div>
      <div class="dl-row">
        <span class="dl-label">{status.message ?? 'Downloading update…'}</span>
        {#if pct != null}<span class="dl-pct">{pct}%</span>{/if}
      </div>
      <p class="restart">The app will restart automatically to finish installing.</p>
    </div>
  {:else if available}
    <div class="avail">
      <span class="avail-text">
        Update available{#if status.updateVersion}<span class="ver"> · v{status.updateVersion}</span>{/if}
      </span>
      <button type="button" class="primary" onclick={install}>Install &amp; restart</button>
    </div>
  {:else}
    <div class="check">
      <button type="button" class="soft" disabled={checking} onclick={check}>
        {checking ? 'Checking' : 'Check for update'}
      </button>
      {#if note}<span class="note">{note}</span>{/if}
    </div>
  {/if}
</div>

<style>
  /* min-height reserves the row so swapping button ⇄ progress never jolts the dialog. */
  .update {
    display: flex;
    min-height: 29px;
    align-items: center;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .avail {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
  }
  .avail-text {
    font-size: var(--text-xs);
    color: var(--ink);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ver {
    color: var(--text-muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .soft {
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition-property: background-color, border-color;
    transition-duration: var(--dur-150);
  }
  .soft:hover:not(:disabled) {
    border-color: var(--border-strong, var(--border));
    background: var(--surface-3);
  }
  .soft:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    flex: none;
    height: 29px;
    padding: 0 var(--space-3);
    border: 1px solid color-mix(in oklch, var(--accent) 60%, transparent);
    border-radius: var(--radius-2);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition-property: background-color, border-color;
    transition-duration: var(--dur-150);
  }
  .primary:hover {
    background: color-mix(in oklch, var(--accent) 22%, transparent);
    border-color: var(--accent);
  }
  .note,
  .muted {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
  }

  /* Downloading */
  .downloading {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    min-width: 0;
  }
  .track {
    height: 6px;
    width: 100%;
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    /* Smooth the streamed width steps; collapses under prefers-reduced-motion via the token. */
    transition-property: width;
    transition-duration: var(--dur-150);
  }
  .fill.indeterminate {
    width: 40%;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    0% {
      margin-left: -40%;
    }
    100% {
      margin-left: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill.indeterminate {
      animation: none;
      width: 100%;
      margin-left: 0;
    }
  }
  .dl-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .dl-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dl-pct {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .restart {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
