<script lang="ts">
  /* Colour swatch/picker — a write-through control over an effect's hue / saturation /
     brightness numeric params. The well reflects those three as one colour (hsv→hex);
     picking a colour decodes back to hsv (hex→hsv) and writes all three through
     `onChange`, so the swatch and the individual sliders can never drift apart. When any
     of the three is envelope-modulated the LIVE output is swept over the voice's life, so
     we show the BASE colour with a small badge rather than implying a static colour is
     authoritative. UI-only: the picker adds no persisted value (hue/sat/bri stay the
     canonical numbers). Built on the native <input type=color> — keyboard-accessible and
     dependency-free. */
  import { hexToHsv, hsvToHex, type Hsv } from '@ledrums/core';
  import Spline from '@lucide/svelte/icons/spline';

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
    class?: string;
  };

  let {
    hue,
    saturation,
    brightness,
    modulated = false,
    disabled = false,
    onChange,
    ariaLabel = 'Colour',
    class: klass,
  }: Props = $props();

  const hex = $derived(hsvToHex(hue, saturation, brightness));

  function pick(e: Event & { currentTarget: HTMLInputElement }) {
    onChange?.(hexToHsv(e.currentTarget.value));
  }
</script>

<div class={['colorswatch', klass]} class:disabled>
  <span class="well" class:modulated style="--swatch: {hex}">
    <input type="color" value={hex} {disabled} oninput={pick} aria-label={ariaLabel} />
    {#if modulated}
      <span class="badge" title="Modulated by an envelope">
        <Spline size={10} aria-hidden="true" />
      </span>
    {/if}
  </span>
  <span class="hex">{modulated ? `base ${hex}` : hex}</span>
</div>

<style>
  .colorswatch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
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
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 55%, var(--border)), var(--shadow-1);
  }
  .well:focus-within {
    box-shadow: 0 0 0 3px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }

  /* The native picker fills the well but paints nothing itself — the well's --swatch
     layer is the visible colour, so it survives the checker/badge overlay. */
  .well input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    opacity: 0;
    cursor: pointer;
  }
  .well input:disabled {
    cursor: default;
  }

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
