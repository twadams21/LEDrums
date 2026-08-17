<script lang="ts">
  /* Project-styled single-value slider built on Bits UI. The filled Range and
     the Thumb are driven by the same value, so the handle, the fill, and the
     readout can never drift apart. Pass `value` one-way with `onChange`, or
     `bind:value` — both work. */
  import { Slider } from 'bits-ui';
  import { wheelStep } from './wheel-step';
  import { splitValueUnit } from './format-unit';

  type Props = {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    /** `vertical` is a fader: it fills upward and stretches to the row's height,
        so a caller must give the wrapper one. Used by CurveField's strength fader. */
    orientation?: 'horizontal' | 'vertical';
    /** Marks a NEUTRAL value on the rail and fills from there to the thumb instead
        of from `min`. That is what makes a bipolar control readable: on a −1..1
        fader a fill starting at the bottom says "30% of the way up", which is not
        what the value means — a fill starting at the notch says "0.4 below
        centre", which is. Presentational only; any magnetic snapping belongs to
        the caller, which owns the value. */
    notchAt?: number | null;
    /** Half-width, in value units, of a MAGNETIC zone around `notchAt`: a drag
        that lands inside it snaps to the notch exactly, so neutral is easy to
        hit without hunting for a pixel. Deliberately pointer-only — a keyboard
        or wheel step is already exact, and a magnet wider than one step would
        trap the thumb on the notch with no way to step off it. */
    notchSnap?: number;
    /** Fired on every change; use this when `value` isn't a bindable local. */
    onChange?: (v: number) => void;
    /** Formats the trailing readout (e.g. `v => v + 'ms'`). */
    format?: (v: number) => string;
    /** Hide the trailing readout when the caller renders its own. */
    showValue?: boolean;
    /** Hide the unit beside the input. Inspector rows carry it on the param LABEL instead
        (an `(i)` tooltip), so every number input in a section aligns to the same column. */
    showUnit?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    orientation = 'horizontal',
    notchAt = null,
    notchSnap = 0,
    onChange,
    format,
    showValue = true,
    showUnit = true,
    ariaLabel,
    class: klass,
  }: Props = $props();

  let draft = $state('');
  let editing = $state(false);
  /* Whether the current change is coming from a pointer drag. Tracked on the
     window rather than the thumb: the thumb re-renders mid-drag, and a listener
     on a node that can be replaced is a listener that can be lost. */
  let dragging = $state(false);

  const precision = $derived(decimalPlaces(step));
  const normalizedValue = $derived(normalizeNumber(value, min, max, step));
  const inputValue = $derived(formatNumber(normalizedValue, precision));
  const display = $derived(format ? format(normalizedValue) : inputValue);
  /* A format that merely dresses the value ("210°", "0.60") prints the SAME number, so the
     box can show the formatter's own rendering — trailing zeros and all — and the remainder
     is the unit. A format that TRANSFORMS the value (a 0…1 depth shown as "45%") prints a
     different number, so the box keeps the real one and the whole read-out reads as the unit:
     showing "45" in a box that commits 45 would be a lie. */
  const parsed = $derived(splitValueUnit(display));
  const literal = $derived(parsed.number !== null && Number(parsed.number) === normalizedValue);
  const shownValue = $derived(literal ? parsed.number! : inputValue);
  const unit = $derived(literal ? parsed.unit : display === inputValue ? '' : display);

  /* ---- Notched (bipolar) fill ---------------------------------------------
     Bits UI's own Range always spans min→value, so a notched slider draws its
     own band between the notch and the thumb and hides Bits'. Both are the same
     `.range` element to the eye — one rule set, one colour, no drift. */
  const notched = $derived(notchAt !== null && notchAt !== undefined);
  const frac = (v: number): number => (max > min ? (v - min) / (max - min) : 0);
  const notchFrac = $derived(Math.min(1, Math.max(0, frac(notchAt ?? min))));
  const valueFrac = $derived(Math.min(1, Math.max(0, frac(normalizedValue))));
  const bandStart = $derived(Math.min(notchFrac, valueFrac));
  const bandSize = $derived(Math.abs(valueFrac - notchFrac));

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

  function emit(next: number) {
    const normalized = normalizeNumber(snapToNotch(next), min, max, step);
    value = normalized;
    onChange?.(normalized);
  }

  /** The magnet, applied only to a pointer drag — see the `notchSnap` prop. */
  function snapToNotch(next: number): number {
    if (!dragging || notchAt === null || notchAt === undefined || !(notchSnap > 0)) return next;
    return Math.abs(next - notchAt) < notchSnap ? notchAt : next;
  }

  function currentDraft(): string {
    return editing ? draft : shownValue;
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

  /* Wheel-adjust: one step per tick anywhere over the slider (track or readout). Emitted
     straight through — a slider already publishes continuously while dragged, so a tick is
     the same kind of event, not a new commit contract. Attached by hand so the listener is
     non-passive: a passive one cannot preventDefault, and the pane would scroll underneath. */
  let root: HTMLDivElement;

  function onWheel(e: WheelEvent): void {
    if (disabled) return;
    const next = wheelStep({ value: normalizedValue, deltaY: e.deltaY, min, max, step });
    if (next === null) return;
    e.preventDefault();
    emit(Number(next));
  }

  /* Both listeners are attached by hand on the same node: `wheel` because it has
     to be non-passive, `pointerdown` because a handler in the markup would put an
     interaction on a wrapper div that has no role of its own. */
  $effect(() => {
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', startPointer);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', startPointer);
    };
  });

  function startPointer(): void {
    if (disabled) return;
    dragging = true;
    const end = (): void => {
      dragging = false;
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
</script>

<div bind:this={root} class={['slider', klass]} class:disabled class:vertical={orientation === 'vertical'}>
  <Slider.Root
    type="single"
    bind:value
    {min}
    {max}
    {step}
    {disabled}
    {orientation}
    onValueChange={handleValueChange}
    aria-label={ariaLabel}
    class="track"
  >
    <span class="rail"></span>
    {#if notched}
      <span class="notch" style:--notch={`${notchFrac * 100}%`}></span>
      <span
        class="range band"
        style:--band-start={`${bandStart * 100}%`}
        style:--band-size={`${bandSize * 100}%`}
      ></span>
    {:else}
      <Slider.Range class="range" />
    {/if}
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
          draft = shownValue;
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
      {#if unit && showUnit}
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

  /* ---- Vertical (fader) ---------------------------------------------------
     Bits swaps the axis for us — Range/Thumb switch to bottom/top inline styles
     under `orientation="vertical"` — so this only has to swap the box: the
     track becomes a full-height column, the rail a narrow vertical well, and
     the readout sits under it (column-reverse, since the wrapper is a flex
     row by default). */
  .slider.vertical {
    flex-direction: column-reverse;
    width: auto;
    height: 100%;
    gap: var(--space-2);
  }
  .slider.vertical :global(.track) {
    flex-direction: column;
    justify-content: center;
    width: 16px;
    height: auto;
    flex: 1;
  }
  .slider.vertical :global(.rail) {
    inset: 0 auto 0 50%;
    width: 5px;
    height: auto;
    transform: translateX(-50%);
  }
  /* Bits sets top/bottom inline (inline wins), so only the axis-specific bits
     the base rule hard-codes need undoing here. */
  .slider.vertical :global(.range) {
    left: 50%;
    width: 5px;
    height: auto;
    transform: translateX(-50%);
  }
  .slider.vertical :global(.thumb) {
    left: 50%;
    /* The base rule's `top: 50%` is NOT overridden inline; leaving it would win
       against the inline `bottom` and pin every thumb to the middle. */
    top: auto;
    transform: translateX(-50%);
  }
  .slider.vertical .value {
    min-width: 0;
    justify-content: center;
  }

  /* ---- Notch (bipolar) ----------------------------------------------------
     The mark sits ON the rail rather than beside it, so the neutral point is
     read in the same glance as the thumb; the band grows out of it in whichever
     direction the value went. Both are absolutely positioned off the same
     fraction, so mark and fill can never disagree about where centre is. */
  .slider .notch {
    position: absolute;
    background: var(--text-muted);
    border-radius: 1px;
    pointer-events: none;
    /* Above the fill: the mark is the reference the fill is measured FROM, so it
       has to stay readable when the fill grows out over it. */
    z-index: 1;
    left: var(--notch);
    top: 50%;
    width: 1px;
    height: 11px;
    transform: translate(-50%, -50%);
  }
  .slider .band {
    position: absolute;
    left: var(--band-start);
    width: var(--band-size);
  }
  .slider.vertical .notch {
    left: 50%;
    top: auto;
    bottom: var(--notch);
    width: 13px;
    height: 1px;
    transform: translate(-50%, 50%);
  }
  .slider.vertical .band {
    left: 50%;
    top: auto;
    bottom: var(--band-start);
    width: 5px;
    height: var(--band-size);
    transform: translateX(-50%);
  }
  .slider.vertical .value input {
    width: 36px;
    text-align: center;
  }
</style>
