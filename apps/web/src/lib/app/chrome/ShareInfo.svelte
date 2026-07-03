<script lang="ts">
  /* Remote-access share surface (S3 + in-app tunnel control). A single Share icon button
     in the TopBar that opens a popover reflecting the server's tunnel lifecycle:
       off      → offer "Start sharing" (spawns the PIN-gated Cloudflare tunnel on demand)
       starting → progress note while cloudflared comes up
       live     → URL + PIN rows with per-row copy, a one-click "Copy invite" (both on
                  separate lines, ready to paste to a bandmate), plus "Stop sharing"
       error    → the server's plain-language failure explanation + "Try again"
     The button renders whenever the server reports a tunnel surface (always, on current
     servers) — it never vanishes silently. Start/stop is editor-only and refused by the
     server for clients that arrived via the tunnel; viewers see the state read-only.
     The popover (Bits UI) closes on outside-click / Escape and is keyboard-accessible. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { onDestroy } from 'svelte';
  import { Popover } from 'bits-ui';
  import Share2 from '@lucide/svelte/icons/share-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import Loader from '@lucide/svelte/icons/loader';

  let { store }: { store: TriggerLab } = $props();

  const tunnel = $derived(store.tunnel);
  const url = $derived(tunnel?.url ?? null);
  const pin = $derived(tunnel?.pin ?? null);
  /** Lifecycle phase; an older server without `status` implies live-if-url (legacy shape). */
  const status = $derived(tunnel?.status ?? (tunnel?.url ? 'live' : 'off'));
  const show = $derived(!!tunnel);
  /** Viewers can look but not start/stop — the server enforces this; we just disable. */
  const canControl = $derived(!store.isViewer);

  let open = $state(false);
  // Which field most recently copied — drives the per-row Copy→Check swap.
  let copiedField = $state<'url' | 'pin' | 'invite' | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(field: 'url' | 'pin' | 'invite', text: string | null): Promise<void> {
    if (!text) return;
    // Guard explicitly: optional chaining alone would resolve (not throw) when the
    // Clipboard API is missing, falsely flipping the row to its "copied" state.
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      copiedField = field;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copiedField = null), 1500);
    } catch {
      /* clipboard unavailable — the value is still visible/selectable in the popover */
    }
  }

  // The copy timer can outlive the component; clear it on teardown.
  onDestroy(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });
</script>

{#if show}
  <Popover.Root bind:open>
    <Popover.Trigger class="share-trigger" aria-label="Share room" title="Share room">
      <Share2 size={15} aria-hidden="true" />
      {#if status !== 'off'}<span class="share-dot" data-status={status} aria-hidden="true"></span>{/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="lab-share-content" sideOffset={8} align="end">
        <div class="share-head">Share room</div>

        {#if status === 'live'}
          {#if url}
            <div class="row">
              <span class="rlabel">URL</span>
              <span class="rval" title={url}>{url}</span>
              <button
                type="button"
                class="copy"
                aria-label="Copy URL"
                title="Copy URL"
                onclick={() => copy('url', url)}
              >
                {#if copiedField === 'url'}<Check size={13} aria-hidden="true" />{:else}<Copy size={13} aria-hidden="true" />{/if}
              </button>
            </div>
          {/if}
          {#if pin}
            <div class="row">
              <span class="rlabel">PIN</span>
              <span class="rval pin">{pin}</span>
              <button
                type="button"
                class="copy"
                aria-label="Copy PIN"
                title="Copy PIN"
                onclick={() => copy('pin', pin)}
              >
                {#if copiedField === 'pin'}<Check size={13} aria-hidden="true" />{:else}<Copy size={13} aria-hidden="true" />{/if}
              </button>
            </div>
          {/if}
          {#if url}
            <button
              type="button"
              class="action invite"
              onclick={() => copy('invite', pin ? `${url}\nPIN: ${pin}` : url)}
            >
              {#if copiedField === 'invite'}<Check size={13} aria-hidden="true" /> Copied{:else}<Copy size={13} aria-hidden="true" /> Copy invite (URL + PIN){/if}
            </button>
          {/if}
          <button type="button" class="action" disabled={!canControl} onclick={() => store.setSharing(false)}>
            Stop sharing
          </button>
        {:else if status === 'starting'}
          <p class="note starting"><Loader size={13} aria-hidden="true" /> Starting the share tunnel…</p>
        {:else if status === 'error'}
          <p class="note error">{tunnel?.error ?? 'The share tunnel failed to start.'}</p>
          <button type="button" class="action" disabled={!canControl} onclick={() => store.setSharing(true)}>
            Try again
          </button>
        {:else}
          <p class="note">
            Not sharing. Start sharing to get a public link to this room — it is always
            protected by a room PIN.
          </p>
          <button type="button" class="action" disabled={!canControl} onclick={() => store.setSharing(true)}>
            Start sharing
          </button>
        {/if}
        {#if !canControl && status !== 'starting'}
          <p class="note faint">Only the editor can start or stop sharing.</p>
        {/if}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  /* Trigger — a ghost icon button matching IconButton's weight, accent-tinted. */
  :global(.share-trigger) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-icon-size);
    height: var(--control-icon-size);
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    color: var(--accent);
    line-height: 0;
    cursor: pointer;
    transition:
      background-color var(--dur-120) ease,
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  :global(.share-trigger:hover),
  :global(.share-trigger[data-state='open']) {
    background: var(--surface-inset);
    border-color: var(--border);
  }
  :global(.share-trigger:active) {
    scale: 0.94;
  }
  /* Lifecycle dot on the trigger: live = ok, starting = warn-ish, error = danger. */
  .share-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .share-dot[data-status='live'] {
    background: var(--ok, #3ecf8e);
  }
  .share-dot[data-status='starting'] {
    background: var(--warn, #e6b450);
  }
  .share-dot[data-status='error'] {
    background: var(--danger, #e5484d);
  }

  /* Popover — portaled to body, uniquely prefixed (mirrors .lab-sel-* / .lab-ctx-*). */
  :global(.lab-share-content) {
    z-index: var(--z-tooltip);
    width: 17rem;
    max-width: min(90vw, 22rem);
    padding: var(--space-2);
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
    transform-origin: var(--bits-popover-content-transform-origin);
    animation: share-pop var(--dur-120) var(--ease-control);
  }
  @keyframes -global-share-pop {
    from {
      opacity: 0;
      scale: 0.97;
      translate: 0 -4px;
    }
    to {
      opacity: 1;
      scale: 1;
      translate: 0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-share-content) {
      animation: none;
    }
  }
  .share-head {
    margin-bottom: var(--space-2);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }
  .row + .row {
    border-top: 1px solid var(--border-faint);
  }
  .rlabel {
    flex: none;
    width: 2.2rem;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .rval {
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rval.pin {
    letter-spacing: 0.12em;
    font-variant-numeric: tabular-nums;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    padding: 0;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    color: var(--text-faint);
    line-height: 0;
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .copy:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .copy:active {
    scale: 0.94;
  }

  /* Status prose + the single start/stop action. */
  .note {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--text);
  }
  .note.faint {
    margin: var(--space-2) 0 0;
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .note.error {
    color: var(--danger, #e5484d);
  }
  .note.starting {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
    color: var(--text-faint);
  }
  .note.starting :global(svg) {
    animation: share-spin 900ms linear infinite;
  }
  @keyframes share-spin {
    to {
      rotate: 360deg;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .note.starting :global(svg) {
      animation: none;
    }
  }
  .action {
    display: block;
    width: 100%;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--ink);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease;
  }
  .action:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .action.invite {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  .action.invite :global(svg) {
    flex: none;
    opacity: 0.85;
  }
</style>
