<script lang="ts">
  /* Top-bar update badge (S07). Surfaces `desktopBridge.bootStatus.updateAvailable` — set by the
     Rust startup OTA check now that the native dialog is gone — as a small accent pill in the chrome.
     Clicking it opens Settings, where the shared UpdateControl runs the identical install flow, so
     the update is reachable from both here and the settings dialog with one implementation. Renders
     nothing outside the desktop app, when no update is available, or while a download is in flight
     (the settings dialog owns the progress surface). */
  import { onMount } from 'svelte';
  import ArrowUpCircle from '@lucide/svelte/icons/arrow-up-circle';
  import { desktopBridge, type DesktopBridge } from '../desktop-bridge.svelte';

  let { bridge = desktopBridge, onOpen }: { bridge?: DesktopBridge; onOpen: () => void } = $props();

  // Idempotent; ensures live boot state wherever the top bar mounts (S08 also starts it at root).
  onMount(() => {
    void bridge.start();
  });

  const show = $derived(
    bridge.isDesktop && bridge.bootStatus.updateAvailable && bridge.bootStatus.stage !== 'updating',
  );
  const version = $derived(bridge.bootStatus.updateVersion);
</script>

{#if show}
  <button
    type="button"
    class="update-badge"
    onclick={onOpen}
    title={version ? `Update available — v${version}. Install & restart.` : 'Update available — install & restart.'}
  >
    <ArrowUpCircle size={13} strokeWidth={2.25} aria-hidden="true" />
    <span class="label">Update</span>
  </button>
{/if}

<style>
  .update-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 var(--space-2);
    border: 1px solid color-mix(in oklch, var(--accent) 50%, transparent);
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    white-space: nowrap;
    cursor: pointer;
    transition-property: background-color, border-color;
    transition-duration: var(--dur-150);
  }
  .update-badge:hover {
    background: color-mix(in oklch, var(--accent) 22%, transparent);
    border-color: var(--accent);
  }
  .label {
    line-height: 1;
  }
</style>
