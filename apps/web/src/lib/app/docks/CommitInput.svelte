<script lang="ts">
  /* Small styled input for the Patch Inspector that COMMITS ON CHANGE (blur / Enter),
     never per keystroke — so a transform / routing / input-map edit isn't re-applied to
     the live device on every digit. Local helper for the Inspector; mirrors the lib/ui
     TextField look on the project tokens (no bare browser control). Handles text + number,
     an optional unit suffix, and min/max clamping for numbers.

     `value` flows one-way; the committed store value flows back in. For a number, an empty
     field commits '' so the caller can decide (clear vs ignore); a non-empty value is
     parsed, finite-checked, and clamped before it reaches `onCommit`. */
  type Props = {
    value: string | number;
    type?: 'text' | 'number';
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    suffix?: string;
    mono?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    /** Fired on commit. Number fields pass a clamped numeric string, or '' when cleared. */
    onCommit: (v: string) => void;
  };

  let {
    value,
    type = 'text',
    min,
    max,
    step,
    placeholder,
    suffix,
    mono = false,
    disabled = false,
    ariaLabel,
    onCommit,
  }: Props = $props();

  function commit(raw: string): void {
    if (type !== 'number') {
      onCommit(raw);
      return;
    }
    if (raw.trim() === '') {
      onCommit(''); // empty number → let the caller clear or ignore
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) return; // ignore garbage; keep the prior value
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    onCommit(String(n));
  }
</script>

<span class={['ci', mono && 'mono']} class:disabled>
  <input
    class="ci-input"
    {type}
    {min}
    {max}
    {step}
    {placeholder}
    {disabled}
    {value}
    aria-label={ariaLabel}
    onchange={(e) => commit(e.currentTarget.value)}
  />
  {#if suffix}<span class="ci-suffix">{suffix}</span>{/if}
</span>

<style>
  .ci {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    padding: 0 9px;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    transition: border-color 120ms ease;
  }
  .ci:focus-within {
    border-color: var(--accent);
  }
  .ci.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .ci-input {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 7px 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text);
    background: transparent;
    border: none;
    font-variant-numeric: tabular-nums;
  }
  .ci.mono .ci-input {
    font-family: var(--font-mono);
  }
  .ci-input::placeholder {
    color: var(--text-faint);
  }
  .ci-input:focus {
    outline: none;
  }
  .ci-suffix {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
</style>
