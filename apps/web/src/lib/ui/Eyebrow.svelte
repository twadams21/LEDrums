<script lang="ts">
  /* Small uppercase section label (mono, tracked) with an optional leading icon. */
  import type { Component, Snippet } from 'svelte';

  type Props = {
    icon?: Component;
    class?: string;
    children: Snippet;
  };

  let { icon: Icon, class: klass, children }: Props = $props();
</script>

<span class={['eyebrow', klass]}>
  {#if Icon}<Icon size={13} aria-hidden="true" />{/if}
  {@render children()}
</span>

<style>
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
</style>
