<script lang="ts">
  /* Read-only 0..1 level meter: a label, a filled track and a tabular percentage readout. The
     signal moves; the chrome stays still — the fill animates by width transition only, and the
     readout uses tabular numerals so a busy meter never shifts its neighbours. Token-driven
     (modulation role tint); the transition collapses under prefers-reduced-motion via --dur-*.
     Semantics: a native `meter` role with min/max/now so screen readers read the value. */
  type Props = {
    /** 0..1; anything else is clamped (NaN reads 0). */
    value: number;
    label: string;
    /** Dim the meter (input not running) without losing its layout. */
    muted?: boolean;
    class?: string;
  };

  let { value, label, muted = false, class: klass }: Props = $props();

  const v = $derived(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  const pct = $derived(Math.round(v * 100));
</script>

<div
  class={['meter', klass]}
  class:muted
  role="meter"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct}
  aria-valuetext={`${pct}%`}
>
  <span class="label">{label}</span>
  <span class="track" aria-hidden="true"><span class="fill" style:width={`${pct}%`}></span></span>
  <span class="readout" aria-hidden="true">{pct}%</span>
</div>

<style>
  .meter {
    display: grid;
    grid-template-columns: 4.5ch 1fr 4ch;
    align-items: center;
    gap: var(--space-2);
    min-height: 22px;
    min-width: 0;
  }
  .label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .track {
    position: relative;
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--role-modulation);
    transition-property: width, opacity;
    transition-duration: var(--dur-90);
    transition-timing-function: var(--ease-out-quart);
  }
  .readout {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    text-align: right;
  }
  .muted .fill {
    opacity: 0.35;
  }
  .muted .readout,
  .muted .label {
    color: var(--text-faint);
  }
</style>
