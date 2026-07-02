<script lang="ts">
  /* One colour token row: swatch, name (click = copy the var), authored OKLCH and
     browser-resolved sRGB readouts. Values are read from the LIVE custom property at
     mount — the artifact can't show a value tokens.css doesn't hold. */
  import { onMount } from 'svelte';
  import CopyChip from './CopyChip.svelte';
  import { tokenRaw, tokenResolved } from './resolve-color';

  let {
    name,
    label,
    onCheckerboard = false,
  }: {
    /** The custom property, e.g. `--accent`. */
    name: string;
    label?: string;
    /** Render the chip over a checkerboard (translucent tokens). */
    onCheckerboard?: boolean;
  } = $props();

  let raw = $state('');
  let resolved = $state('');
  onMount(() => {
    raw = tokenRaw(name);
    resolved = tokenResolved(name);
  });
</script>

<div class="swatch">
  <span class="chip" class:checker={onCheckerboard}><i style="background: var({name})"></i></span>
  <div class="meta">
    <span class="row1">
      <CopyChip text={name} title={`Copy ${name}`} />
      {#if label}<span class="lbl">{label}</span>{/if}
    </span>
    <span class="vals">
      <code class="raw">{raw}</code>
      {#if resolved}<code class="res">{resolved}</code>{/if}
    </span>
  </div>
</div>

<style>
  .swatch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .chip {
    flex: none;
    width: 44px;
    height: 34px;
    border-radius: var(--radius-2);
    border: 1px solid var(--border-faint);
    overflow: hidden;
  }
  .chip i {
    display: block;
    width: 100%;
    height: 100%;
  }
  .chip.checker {
    background:
      repeating-conic-gradient(oklch(0.35 0 0) 0% 25%, oklch(0.25 0 0) 0% 50%) 0 0 / 12px 12px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .lbl {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vals {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .raw {
    color: var(--text-faint);
  }
  .res {
    color: var(--text-disabled);
    flex: none;
  }
</style>
