<script lang="ts">
  /* Pill-shaped search input with a leading icon and a clear button. */
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import type { ControlProps } from './control-props';

  type Props = ControlProps<string> & {
    value: string;
    placeholder?: string;
  };

  let {
    value = $bindable(''),
    placeholder = 'Search…',
    onChange,
    disabled = false,
    ariaLabel = 'Search',
    class: klass,
  }: Props = $props();

  function clear(): void {
    // Fail closed in the handler, not only on the attribute: `disabled` + `pointer-events:
    // none` already stop a real pointer, but a programmatic click still reaches a listener,
    // and "disabled" has to mean inert wherever the call came from.
    if (disabled) return;
    value = '';
    onChange?.('');
  }
</script>

<div class={['search', klass]} class:disabled>
  <Search size={14} class="search-icon" aria-hidden="true" />
  <input
    class="search-input"
    type="text"
    {placeholder}
    {disabled}
    aria-label={ariaLabel}
    bind:value
    oninput={(e) => onChange?.(e.currentTarget.value)}
  />
  {#if value}
    <button class="search-clear" type="button" {disabled} onclick={clear} aria-label="Clear search">
      <X size={13} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
  .search {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 8px 0 11px;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill, 999px);
    color: var(--text-faint);
    transition: border-color var(--dur-120) ease, color var(--dur-120) ease;
  }
  .search:focus-within {
    border-color: var(--accent);
    color: var(--text);
  }
  /* Matches TextField's `.tf:disabled` treatment — the pill is the control here, so it
     dims as one rather than leaving a live-looking frame around a dead input. */
  .search.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .search :global(.search-icon) {
    flex: none;
  }
  .search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-xs);
  }
  .search-input::placeholder {
    color: var(--text-faint);
  }
  /* the outer pill shows focus; suppress the global ring on the inner input */
  .search-input:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-pill, 999px);
    color: var(--text-faint);
    transition: color var(--dur-120) ease, background-color var(--dur-120) ease, scale var(--dur-120) ease;
  }
  .search-clear:hover {
    color: var(--ink);
    background: var(--surface-3);
  }
  .search-clear:active {
    scale: 0.9;
  }
</style>
