<script lang="ts">
  /* Surface container. Optional header (with bottom divider), padding + surface
     variants, and an interactive hover state. */
  import type { Snippet } from 'svelte';

  type Props = {
    surface?: 'raised' | 'inset' | 'bare';
    padding?: 'none' | 'sm' | 'md';
    interactive?: boolean;
    tint?: string;
    class?: string;
    header?: Snippet;
    children: Snippet;
  };

  let {
    surface = 'raised',
    padding = 'md',
    interactive = false,
    tint,
    class: klass,
    header,
    children,
  }: Props = $props();
</script>

<div
  class={['card', `sf-${surface}`, klass]}
  class:interactive
  style={tint ? `--tint:${tint}` : undefined}
>
  {#if header}
    <div class="card-head pad-{padding}">{@render header()}</div>
  {/if}
  <div class="card-body pad-{padding}">{@render children()}</div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    transition: border-color 140ms ease, transform 140ms ease;
  }
  .sf-raised {
    background: var(--surface-2);
  }
  .sf-inset {
    background: var(--surface-inset);
  }
  .sf-bare {
    background: transparent;
  }
  .interactive {
    cursor: pointer;
  }
  .interactive:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  .card-head {
    border-bottom: 1px solid var(--border-faint);
  }
  .pad-none {
    padding: 0;
  }
  .pad-sm {
    padding: var(--space-2) var(--space-3);
  }
  .pad-md {
    padding: var(--space-3) var(--space-4);
  }
</style>
