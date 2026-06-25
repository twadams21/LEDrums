<script lang="ts">
  /* Modal dialog on Bits UI. Portals to <body>, traps focus, locks scroll, and
     closes on Esc / outside-click — composing with Bits Select/Toggle layers
     (which native <dialog> top-layer would render behind). `open` is driven by
     the caller; `onClose` fires on any dismissal. `layer` raises the z-index so
     a second dialog (e.g. the envelope popup) stacks above the first. */
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    open: boolean;
    onClose?: () => void;
    title?: string;
    /** Stacking tier: 1 = base, 2 = above another dialog. */
    layer?: number;
    class?: string;
    children: Snippet;
  };

  let { open, onClose, title, layer = 1, class: klass, children }: Props = $props();

  const overlayZ = $derived(60 + layer * 10);

  function onOpenChange(v: boolean): void {
    if (!v) onClose?.();
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="lab-dialog-overlay" style="z-index:{overlayZ}" />
    <Dialog.Content class={['lab-dialog-content', klass]} style="z-index:{overlayZ + 1}">
      {#if title}<Dialog.Title class="lab-dialog-srtitle">{title}</Dialog.Title>{/if}
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.lab-dialog-overlay) {
    position: fixed;
    inset: 0;
    background: oklch(0.1 0.01 256 / 0.6);
    backdrop-filter: blur(2px);
    animation: dlg-overlay-in 140ms ease;
  }
  :global(.lab-dialog-content) {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    transform-origin: center;
    display: flex;
    flex-direction: column;
    max-height: 88vh;
    overflow: hidden;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
    animation: dlg-content-in 160ms cubic-bezier(0.2, 0, 0, 1);
  }
  :global(.lab-dialog-content:focus-visible) {
    outline: none;
  }
  @keyframes -global-dlg-overlay-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes -global-dlg-content-in {
    from {
      opacity: 0;
      scale: 0.97;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-dialog-overlay),
    :global(.lab-dialog-content) {
      animation: none;
    }
  }
  :global(.lab-dialog-srtitle) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
