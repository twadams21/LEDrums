<script lang="ts">
  /* Colour swatch/picker — a write-through control over an effect's hue / saturation /
     brightness numeric params. The well reflects those three as one colour (hsv→hex);
     picking a colour decodes back to hsv (hex→hsv) and writes all three through
     `onChange`, so the swatch and the individual sliders can never drift apart. When any
     of the three is envelope-modulated the LIVE output is swept over the voice's life, so
     we show the BASE colour with a small badge rather than implying a static colour is
     authoritative. UI-only: the picker adds no persisted value (hue/sat/bri stay the
     canonical numbers). The box opens the app's colour window (ColorPicker) — a click opens it and
     a click again closes it (Tim, 2026-10-07), which the browser's own picker can't do. */
  import { hsvToHex, type Hsv } from '@ledrums/core';
  import Spline from '@lucide/svelte/icons/spline';
  import ColorPicker from './ColorPicker.svelte';

  type Props = {
    /** Hue in degrees (0..360). */
    hue: number;
    /** Saturation 0..1. */
    saturation: number;
    /** Brightness/value 0..1. */
    brightness: number;
    /** true → one or more of hue/sat/bri is driven by an envelope; show the badge. */
    modulated?: boolean;
    disabled?: boolean;
    /** Fired with the decoded HSV when the user picks a colour. */
    onChange?: (hsv: Hsv) => void;
    ariaLabel?: string;
    /** A small well alone — no hex — to sit beside a param's slider on a card row. */
    compact?: boolean;
    class?: string;
    /** One pick (the colour window open → closed) as one undo step. */
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  };

  let {
    hue,
    saturation,
    brightness,
    modulated = false,
    disabled = false,
    onChange,
    ariaLabel = 'Colour',
    compact = false,
    class: klass,
    onGestureStart,
    onGestureEnd,
  }: Props = $props();

  const hex = $derived(hsvToHex(hue, saturation, brightness));

</script>

<div class={['colorswatch', klass]} class:disabled class:compact>
  <span class="well" class:modulated style="--swatch: {hex}">
    <ColorPicker hsv={{ h: hue, s: saturation, v: brightness }} {disabled} {ariaLabel} {onChange} {onGestureStart} {onGestureEnd} />
    {#if modulated}
      <span class="badge" title="Modulated by an envelope">
        <Spline size={10} aria-hidden="true" />
      </span>
    {/if}
  </span>
  {#if !compact}<span class="hex">{modulated ? `base ${hex}` : hex}</span>{/if}
</div>

<style>
  .colorswatch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }
  .colorswatch.compact {
    width: auto;
    flex: none;
  }
  .colorswatch.compact .well {
    width: 26px;
    height: 18px;
    border-radius: var(--radius-1);
  }
  .colorswatch.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .well {
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    border-radius: var(--radius-2);
    /* A checker under the swatch reads correctly even at brightness 0. */
    background:
      linear-gradient(var(--swatch), var(--swatch)),
      conic-gradient(var(--border-faint) 0 25%, transparent 0 50%, var(--border-faint) 0 75%, transparent 0) 0 0 / 10px 10px;
    box-shadow: inset 0 0 0 1px var(--border), var(--shadow-1);
    overflow: hidden;
    transition: box-shadow var(--dur-120) ease;
  }
  .well:hover {
    box-shadow: inset 0 0 0 1px var(--border-accent), var(--shadow-1);
  }
  .well:has(:global(.colorpicker-trigger:focus-visible)) {
    box-shadow: 0 0 0 3px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }

  /* The native picker fills the well but paints nothing itself — the well's --swatch
     layer is the visible colour, so it survives the checker/badge overlay. */

  .badge {
    position: absolute;
    top: -5px;
    right: -5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-pill, 999px);
    color: var(--ink);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 55%, transparent);
    pointer-events: none;
  }

  .hex {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
</style>
