<script lang="ts">
  /* Remote-access share surface (S3). A single Share icon button in the TopBar that
     opens a small popover holding the tunnel URL and room PIN, each with its own copy
     button. Shown only when the server reports a tunnel URL and/or a room PIN
     (store.tunnel) — same condition as the old inline pill, but folded behind one
     button so the bar stays uncluttered. The popover (Bits UI) closes on outside-click
     / Escape and is keyboard-accessible. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { Popover } from 'bits-ui';
  import Share2 from '@lucide/svelte/icons/share-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';

  let { store }: { store: TriggerLab } = $props();

  const tunnel = $derived(store.tunnel);
  const url = $derived(tunnel?.url ?? null);
  const pin = $derived(tunnel?.pin ?? null);
  // Same gate as the legacy pill: only offer Share once there's something to share.
  const show = $derived(!!tunnel && (!!url || !!pin));

  let open = $state(false);
  // Which field most recently copied — drives the per-row Copy→Check swap.
  let copiedField = $state<'url' | 'pin' | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(field: 'url' | 'pin', text: string | null): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      copiedField = field;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copiedField = null), 1500);
    } catch {
      /* clipboard unavailable — the value is still visible/selectable in the popover */
    }
  }
</script>

{#if show}
  <Popover.Root bind:open>
    <Popover.Trigger class="share-trigger" aria-label="Share room link and PIN" title="Share room">
      <Share2 size={15} aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="lab-share-content" sideOffset={8} align="end">
        <div class="share-head">Share room</div>
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
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  /* Trigger — a ghost icon button matching IconButton's weight, accent-tinted. */
  :global(.share-trigger) {
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
</style>
