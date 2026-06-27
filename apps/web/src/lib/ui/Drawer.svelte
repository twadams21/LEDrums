<script lang="ts">
  /* Slide-in overlay panel built on Bits Dialog (portaled, focus-trapped, closes
     on Esc / outside-click). Slides from an edge. `open` is caller-driven. */
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';

  type Props = {
    open: boolean;
    onClose?: () => void;
    side?: 'right' | 'left' | 'bottom';
    title?: string;
    width?: string;
    class?: string;
    children: Snippet;
  };

  let { open, onClose, side = 'right', title, width = '380px', class: klass, children }: Props = $props();

  function onOpenChange(v: boolean): void {
    if (!v) onClose?.();
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="lab-drawer-overlay" />
    <Dialog.Content
      class={['lab-drawer', `dw-${side}`, klass]}
      style={side === 'bottom' ? undefined : `width:${width}`}
    >
      {#if title}
        <header class="dw-head">
          <Dialog.Title class="dw-title">{title}</Dialog.Title>
          <button class="dw-close" type="button" onclick={() => onClose?.()} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
      {/if}
      <div class="dw-body">{@render children()}</div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.lab-drawer-overlay) {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: var(--overlay);
    backdrop-filter: blur(2px);
    animation: dw-fade 140ms ease;
  }
  :global(.lab-drawer) {
    position: fixed;
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-3);
  }
  :global(.lab-drawer.dw-right) {
    top: 0;
    right: 0;
    height: 100vh;
    border-radius: var(--radius-3) 0 0 var(--radius-3);
    animation: dw-in-right 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  :global(.lab-drawer.dw-left) {
    top: 0;
    left: 0;
    height: 100vh;
    border-radius: 0 var(--radius-3) var(--radius-3) 0;
    animation: dw-in-left 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  :global(.lab-drawer.dw-bottom) {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 80vh;
    border-radius: var(--radius-3) var(--radius-3) 0 0;
    animation: dw-in-bottom 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  :global(.lab-drawer:focus-visible) {
    outline: none;
  }
  .dw-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-faint);
    background: var(--surface-2);
  }
  .dw-head :global(.dw-title) {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--ink);
  }
  .dw-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-icon-size);
    height: var(--control-icon-size);
    padding: 0;
    background: transparent;
    border: none;
    color: var(--text-faint);
    border-radius: var(--radius-2);
    transition: color 120ms ease, background-color 120ms ease, scale 120ms ease;
  }
  .dw-close:hover {
    color: var(--ink);
    background: var(--surface-inset);
  }
  .dw-close:active {
    scale: 0.94;
  }
  .dw-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-4);
  }
  @keyframes -global-dw-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes -global-dw-in-right {
    from {
      translate: 100% 0;
    }
    to {
      translate: 0 0;
    }
  }
  @keyframes -global-dw-in-left {
    from {
      translate: -100% 0;
    }
    to {
      translate: 0 0;
    }
  }
  @keyframes -global-dw-in-bottom {
    from {
      translate: 0 100%;
    }
    to {
      translate: 0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-drawer-overlay),
    :global(.lab-drawer) {
      animation: none;
    }
  }
</style>
