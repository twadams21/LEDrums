<script lang="ts">
  /* Custom tooltip on Bits UI. Wraps arbitrary content (incl. buttons) without
     emitting a nested <button> — the trigger props are spread onto a span anchor.
     Fast by default. */
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    text: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    delay?: number;
    class?: string;
    children: Snippet;
  };

  let { text, side = 'top', delay = 120, class: klass, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={delay} disableHoverableContent>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class={['tt-anchor', klass]}>{@render children()}</span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content {side} sideOffset={6} class="lab-tt">{text}</Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  .tt-anchor {
    display: inline-flex;
  }
  :global(.lab-tt) {
    z-index: 100;
    padding: 4px 8px;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-label);
    color: var(--ink);
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
    transform-origin: var(--bits-tooltip-content-transform-origin);
    animation: tt-in 110ms var(--ease-control);
  }
  @keyframes -global-tt-in {
    from {
      opacity: 0;
      scale: 0.94;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.lab-tt) {
      animation: none;
    }
  }
</style>
