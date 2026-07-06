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

  let draft = $state('');
  let editing = $state(false);

  const precision = $derived(decimalPlaces(step));
  const normalizedValue = $derived(normalizeNumber(value, min, max, step));
  const inputValue = $derived(formatNumber(normalizedValue, precision));
  const display = $derived(format ? format(normalizedValue) : inputValue);
  const unit = $derived(inferUnit(display, inputValue));

  function decimalPlaces(n: number): number {
    const text = String(n);
    if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
    return text.includes('.') ? text.split('.')[1]?.length ?? 0 : 0;
  }

  function formatNumber(n: number, places: number): string {
    if (places <= 0) return String(Math.round(n));
    return n.toFixed(places).replace(/\.?0+$/, '');
  }

  function normalizeNumber(n: number, lo: number, hi: number, inc: number): number {
    const finite = Number.isFinite(n) ? n : lo;
    const clamped = Math.min(hi, Math.max(lo, finite));
    if (!(inc > 0)) return clamped;
    const stepped = lo + Math.round((clamped - lo) / inc) * inc;
    return Math.min(hi, Math.max(lo, Number(stepped.toFixed(decimalPlaces(inc) + 2))));
  }

  function inferUnit(formatted: string, numeric: string): string {
    if (formatted === numeric) return '';
    if (Number.isFinite(Number(formatted.trim()))) return '';
    if (formatted.startsWith(numeric)) return formatted.slice(numeric.length).trim();
    if (formatted.endsWith(numeric)) return formatted.slice(0, -numeric.length).trim();
    return formatted;
  }

  function emit(next: number) {
    const normalized = normalizeNumber(next, min, max, step);
    value = normalized;
    onChange?.(normalized);
  }

  function currentDraft(): string {
    return editing ? draft : inputValue;
  }

  function commit() {
    const raw = currentDraft().trim();
    if (raw === '') {
      draft = inputValue;
      editing = false;
      return;
    }

    const next = Number(raw);
    if (!Number.isFinite(next)) {
      draft = inputValue;
      editing = false;
      return;
    }

    emit(next);
    draft = formatNumber(normalizeNumber(next, min, max, step), precision);
    editing = false;
  }

  function cancel() {
    draft = inputValue;
    editing = false;
  }

  function handleValueChange(next: number) {
    emit(next);
    if (!editing) draft = formatNumber(normalizeNumber(next, min, max, step), precision);
  }
</script>

<div class={['slider', klass]} class:disabled>
  <Slider.Root
    type="single"
    bind:value
    {min}
    {max}
    {step}
    {disabled}
    onValueChange={handleValueChange}
    aria-label={ariaLabel}
    class="track"
  >
    <span class="rail"></span>
    <Slider.Range class="range" />
    <Slider.Thumb index={0} class="thumb" />
  </Slider.Root>
  {#if showValue}
    <label class="value" title={display}>
      <input
        type="text"
        inputmode="decimal"
        aria-label={ariaLabel ? `${ariaLabel} value` : 'Slider value'}
        value={currentDraft()}
        {disabled}
        onfocus={() => {
          draft = inputValue;
          editing = true;
        }}
        oninput={(event) => {
          draft = event.currentTarget.value;
          editing = true;
        }}
        onblur={commit}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            event.currentTarget.blur();
          }
        }}
      />
      {#if unit}
        <span class="unit">{unit}</span>
      {/if}
    </label>
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
    border: 2px solid var(--ink);
    box-shadow: var(--shadow-1);
    cursor: grab;
    transition: box-shadow var(--dur-120) ease, border-color var(--dur-120) ease;
  }
  .slider :global(.thumb:hover) {
    border-color: var(--accent);
    /* background: var(--accent); */
  }
  .slider :global(.thumb:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .slider :global(.thumb[data-active]) {
    cursor: grabbing;
  }

  .value {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    min-width: 54px;
    height: var(--control-h-sm, 24px);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .value input {
    width: 46px;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
    outline: none;
    transition: box-shadow var(--dur-120) ease, background var(--dur-120) ease;
  }
  .value input:hover {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .value input:focus-visible {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
  }
  .unit {
    color: var(--text-faint);
  }
</style>
