<script lang="ts">
  /* The tinted icon chip that carries a node's role/kind colour — a square wash of the
     tint behind a Lucide glyph. Extracted from NodeCard so the SAME chip is the node
     visual language everywhere it appears: on the canvas node card, and on the Add pane's
     category tiles (so a category reads as part of that language, not a separate control).
     Presentational only; `size` scales the chip and the glyph together. */
  import type { Component } from 'svelte';

  let {
    icon: Icon,
    tint,
    size = 30,
  }: {
    icon: Component;
    /** CSS colour for the role/kind tint. */
    tint: string;
    /** Chip edge in px; the glyph scales to ~53% of it. */
    size?: number;
  } = $props();

  const glyph = $derived(Math.round(size * 0.53));
</script>

<span
  class="chip"
  style="--tint:{tint}; --chip:{size}px"
  aria-hidden="true"
>
  <Icon size={glyph} aria-hidden="true" />
</span>

<style>
  /* signal-path role / kind colour rides the icon chip (icon + tinted wash) */
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--chip);
    height: var(--chip);
    border-radius: var(--radius-2);
    color: var(--tint);
    background: color-mix(in oklch, var(--tint) 16%, transparent);
  }
</style>
