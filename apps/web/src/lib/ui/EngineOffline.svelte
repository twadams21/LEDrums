<script lang="ts">
  /* The honest empty state for a surface whose content comes from the ENGINE — the visualiser's
     frames, the dock's voices, the transport's clock. The browser renders nothing of its own
     (INIT-01 Decision 3 retired the offline preview), so when the link is down these surfaces say
     so instead of showing a simulation, a frozen last-known reading, or a plausible zero.

     Neutral-toned, never the red fault alarm and never the warn triangle: a closed link while you
     author is an ordinary state, not a failure. Tone never lives in colour alone (glyph + copy).

     Two shapes:
     · 'overlay' — a centred plate over a stage/canvas (the Visualizer). Pointer-transparent, so it
                   never eats a drag on the surface underneath, and translucent enough that the kit
                   geometry stays readable behind it — the geometry is authored data, only the
                   OUTPUT is missing.
     · 'inline'  — one micro row in a list or panel where a value would have been. */
  import Unplug from '@lucide/svelte/icons/unplug';

  let {
    variant = 'inline',
    label = 'Engine disconnected',
    detail,
  }: {
    variant?: 'overlay' | 'inline';
    /** The state, in the surface's own words (e.g. "No voices — engine disconnected"). */
    label?: string;
    /** One line on what that means here. Overlay only; inline stays a single row. */
    detail?: string;
  } = $props();
</script>

{#if variant === 'overlay'}
  <div class="eo-overlay" role="status">
    <div class="eo-plate">
      <Unplug size={15} class="eo-glyph" aria-hidden="true" />
      <p class="eo-copy">
        <span class="eo-label">{label}</span>
        {#if detail}<span class="eo-detail">{detail}</span>{/if}
      </p>
    </div>
  </div>
{:else}
  <span class="eo-inline" role="status">
    <Unplug size={11} class="eo-glyph" aria-hidden="true" />
    {label}
  </span>
{/if}

<style>
  /* --- overlay ------------------------------------------------------------- */
  .eo-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    /* Never intercept a pointer: the stage under this still pans/rotates. */
    pointer-events: none;
  }
  .eo-plate {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    max-width: 30ch;
    /* padding 8px + inner text radius 0 ⇒ plate radius stays the card step, one level out from
       the flat stage it sits on (concentric radius). */
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-2);
    background: color-mix(in oklch, var(--surface-3) 88%, transparent);
    /* Layered shadow instead of a border — it lifts off any stage colour without drawing a hard
       edge across the kit behind it. */
    box-shadow:
      var(--shadow-2),
      inset 0 0 0 1px color-mix(in oklch, var(--border-faint) 70%, transparent);
  }
  .eo-plate :global(.eo-glyph) {
    flex: none;
    margin-top: 1px;
    color: var(--text-faint);
  }
  .eo-copy {
    margin: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }
  .eo-label {
    font-size: var(--text-xs);
    font-weight: 550;
    color: var(--text-muted);
  }
  .eo-detail {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  /* --- inline -------------------------------------------------------------- */
  .eo-inline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: var(--text-disabled);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
  }
  .eo-inline :global(.eo-glyph) {
    flex: none;
    opacity: 0.85;
  }
</style>
