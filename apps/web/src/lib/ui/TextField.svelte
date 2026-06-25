<script lang="ts">
  /* Project-styled text input. `value` is bindable; `onChange` fires on input. */
  type Props = {
    value: string;
    placeholder?: string;
    onChange?: (v: string) => void;
    mono?: boolean;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value = $bindable(''),
    placeholder,
    onChange,
    mono = false,
    disabled = false,
    id,
    ariaLabel,
    class: klass,
  }: Props = $props();
</script>

<input
  {id}
  class={['tf', klass]}
  class:mono
  type="text"
  {placeholder}
  {disabled}
  aria-label={ariaLabel}
  bind:value
  oninput={(e) => onChange?.(e.currentTarget.value)}
/>

<style>
  .tf {
    width: 100%;
    padding: 7px 9px;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    transition: border-color 120ms ease;
  }
  .tf.mono {
    font-family: var(--font-mono);
  }
  .tf::placeholder {
    color: var(--text-faint);
  }
  .tf:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tf:disabled {
    opacity: 0.5;
    pointer-events: none;
  }
</style>
