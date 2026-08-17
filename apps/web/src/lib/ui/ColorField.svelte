<script lang="ts">
  /* Hex colour control with an explicit NO-COLOUR state.

     Distinct from `ColorSwatch`, which is a write-through view over an effect's separate
     hue / saturation / brightness NUMBER params and can therefore never be "unset". This one
     owns a single `#rrggbb` string that may legitimately be absent — a splice with no colour
     renders its effect untinted (or nothing at all), which is a different authored decision
     from "a colour that happens to be black". The two states are visually distinct: a colour
     fills the well, none shows the checker through it.

     Built on the native <input type=color> — keyboard-accessible and dependency-free. */
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';

  type Props = {
    /** Current colour as `#rrggbb`, or `null` for none. */
    value: string | null;
    /** Fired with the new colour, or `null` when cleared. */
    onChange?: (value: string | null) => void;
    /** Colour offered when picking from the none state. */
    fallback?: string;
    /** false → hide the clear affordance (the colour is required). */
    clearable?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value,
    onChange,
    fallback = '#ffffff',
    clearable = true,
    disabled = false,
    ariaLabel = 'Colour',
    class: klass,
  }: Props = $props();

  const hex = $derived(value ?? fallback);

  function pick(e: Event & { currentTarget: HTMLInputElement }) {
    onChange?.(e.currentTarget.value);
  }
</script>

<div class={['colorfield', klass]} class:disabled>
  <span class="well" class:none={value == null} style="--swatch: {hex}">
    <input type="color" value={hex} {disabled} oninput={pick} aria-label={ariaLabel} />
    {#if value == null}
      <span class="addhint" aria-hidden="true"><Plus size={11} /></span>
    {/if}
  </span>
  <span class="hex" class:muted={value == null}>{value ?? 'None'}</span>
  {#if clearable && value != null && !disabled}
    <button type="button" class="clear" onclick={() => onChange?.(null)} aria-label="{ariaLabel}: clear">
      <X size={12} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
  .colorfield {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }
  .colorfield.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .well {
    position: relative;
    flex: none;
    width: 34px;
    height: 22px;
    border-radius: var(--radius-2);
    /* A colour paints over the checker; the none state lets the checker show through, so the
       two states never read as "the same control with a dark colour". */
    background:
      linear-gradient(var(--swatch), var(--swatch)),
      conic-gradient(var(--border-faint) 0 25%, transparent 0 50%, var(--border-faint) 0 75%, transparent 0) 0 0 / 8px 8px;
    box-shadow: inset 0 0 0 1px var(--border), var(--shadow-1);
    overflow: hidden;
    transition: box-shadow var(--dur-120) ease;
  }
  .well.none {
    background: conic-gradient(var(--border-faint) 0 25%, transparent 0 50%, var(--border-faint) 0 75%, transparent 0) 0 0 / 8px 8px;
  }
  .well:hover {
    box-shadow: inset 0 0 0 1px var(--border-accent), var(--shadow-1);
  }
  .well:focus-within {
    box-shadow: 0 0 0 3px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }

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

  .addhint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    pointer-events: none;
  }

  .hex {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hex.muted {
    text-transform: none;
    opacity: 0.7;
  }

  .clear {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-icon-size, 22px);
    height: var(--control-icon-size, 22px);
    padding: 0;
    border: none;
    border-radius: var(--radius-2);
    color: var(--text-muted);
    background: transparent;
    cursor: pointer;
    transition: color var(--dur-120) ease, background var(--dur-120) ease;
  }
  .clear:hover {
    color: var(--ink);
    background: var(--surface-raised);
  }
  .clear:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }
</style>
