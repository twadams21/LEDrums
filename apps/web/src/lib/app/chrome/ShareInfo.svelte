<script lang="ts">
  /* Remote-access share surface (S3). A compact TopBar pill, shown only when the server reports
     a tunnel URL and/or a room PIN (store.tunnel). It lets the host hand a remote viewer the
     public URL + PIN; clicking copies "<url> (PIN <pin>)" to the clipboard. The prominent
     in-shell share surface is S4/Tauri — this is the minimal one. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Share2 from '@lucide/svelte/icons/share-2';
  import Check from '@lucide/svelte/icons/check';

  let { store }: { store: TriggerLab } = $props();

  const tunnel = $derived(store.tunnel);
  const show = $derived(!!tunnel && (!!tunnel.url || !!tunnel.pin));
  // The URL's host for the compact label (the full URL rides the title + clipboard).
  const host = $derived.by(() => {
    const url = tunnel?.url;
    if (!url) return null;
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  });
  const shareText = $derived.by(() => {
    if (!tunnel) return '';
    const parts: string[] = [];
    if (tunnel.url) parts.push(tunnel.url);
    if (tunnel.pin) parts.push(`(PIN ${tunnel.pin})`);
    return parts.join(' ');
  });

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(): Promise<void> {
    if (!shareText) return;
    try {
      await navigator.clipboard?.writeText(shareText);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable — the title still shows the full URL + PIN */
    }
  }
</script>

{#if show}
  <button type="button" class="share" title={`Copy share link — ${shareText}`} onclick={copy}>
    <span class="ic" aria-hidden="true">
      {#if copied}<Check size={13} />{:else}<Share2 size={13} />{/if}
    </span>
    <span class="labels">
      <span class="host">{host ?? 'Tunnel starting…'}</span>
      {#if tunnel?.pin}<span class="pin">PIN {tunnel.pin}</span>{/if}
    </span>
  </button>
{/if}

<style>
  .share {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 220px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    color: var(--text-faint);
    cursor: pointer;
  }
  .share:hover {
    background: var(--surface-3);
    border-color: var(--border);
  }
  .ic {
    display: grid;
    place-items: center;
    color: var(--accent);
    flex: none;
  }
  .labels {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    min-width: 0;
    text-align: left;
  }
  .host {
    font-size: var(--text-2xs);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
</style>
