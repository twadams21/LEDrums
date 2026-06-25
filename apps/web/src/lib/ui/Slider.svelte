<script lang="ts">
  /* Project-styled single-value slider built on Bits UI. The filled Range and
     the Thumb are driven by the same value, so the handle, the fill, and the
     readout can never drift apart. Pass `value` one-way with `onChange`, or
     `bind:value` — both work. */
  import { Slider } from 'bits-ui';

  type Props = {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    /** Fired on every change; use this when `value` isn't a bindable local. */
    onChange?: (v: number) => void;
    /** Formats the trailing readout (e.g. `v => v + 'ms'`). */
    format?: (v: number) => string;
    /** Hide the trailing readout when the caller renders its own. */
    showValue?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    onChange,
    format,
    showValue = true,
    ariaLabel,
    class: klass,
  }: Props = $props();

  const display = $derived(format ? format(value) : String(value));
</script>

<div class={['slider', klass]} class:disabled>
  <Slider.Root
    type="single"
    bind:value
    {min}
    {max}
    {step}
    {disabled}
    onValueChange={onChange}
    aria-label={ariaLabel}
    class="track"
  >
    <span class="rail"></span>
    <Slider.Range class="range" />
    <Slider.Thumb index={0} class="thumb" />
  </Slider.Root>
  {#if showValue}
    <span class="value">{display}</span>
  {/if}
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }
  .slider.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  /* Bits UI renders Root/Range/Thumb as plain spans; positioning comes from
     inline styles (Range: left/right %, Thumb: left:value% + translate). */
  .slider :global(.track) {
    position: relative;
    flex: 1;
    height: 16px; /* hit area; visual rail is thinner via ::the .rail span */
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .slider :global(.rail) {
    position: absolute;
    inset: 0 0;
    top: 50%;
    height: 5px;
    transform: translateY(-50%);
    border-radius: var(--radius-pill, 999px);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  .slider :global(.range) {
    height: 5px;
    top: 50%;
    transform: translateY(-50%);
    border-radius: var(--radius-pill, 999px);
    background: var(--accent);
  }
  .slider :global(.thumb) {
    display: block;
    width: 14px;
    height: 14px;
    top: 50%;
    transform: translateY(-50%);
    border-radius: 50%;
    background: var(--ink);
    border: 2px solid var(--accent);
    box-shadow: var(--shadow-1);
    cursor: grab;
    transition: box-shadow 120ms ease, border-color 120ms ease;
  }
  .slider :global(.thumb:hover) {
    border-color: color-mix(in oklch, var(--accent) 70%, var(--ink));
  }
  .slider :global(.thumb:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .slider :global(.thumb[data-active]) {
    cursor: grabbing;
  }

  .value {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    min-width: 46px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
