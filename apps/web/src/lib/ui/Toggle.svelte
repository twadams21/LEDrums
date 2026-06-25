<script lang="ts">
  /* Two-state on/off toggle on Bits UI Toggle, styled to match the segmented
     buttons. Pass `pressed` + `onChange`, or `bind:pressed`. */
  import { Toggle } from 'bits-ui';

  type Props = {
    pressed: boolean;
    onChange?: (v: boolean) => void;
    disabled?: boolean;
    onLabel?: string;
    offLabel?: string;
    ariaLabel?: string;
    class?: string;
  };

  let {
    pressed = $bindable(false),
    onChange,
    disabled = false,
    onLabel = 'on',
    offLabel = 'off',
    ariaLabel,
    class: klass,
  }: Props = $props();
</script>

<span class={['tgl', klass]}>
  <Toggle.Root bind:pressed onPressedChange={onChange} {disabled} aria-label={ariaLabel} class="tgl-btn">
    {pressed ? onLabel : offLabel}
  </Toggle.Root>
</span>

<style>
  .tgl {
    display: inline-flex;
  }
  .tgl :global(.tgl-btn) {
    padding: 2px var(--space-3);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    color: var(--text-faint);
    cursor: pointer;
    transition-property: background-color, color, border-color, scale;
    transition-duration: 120ms;
    transition-timing-function: ease;
  }
  .tgl :global(.tgl-btn:hover) {
    color: var(--text);
  }
  .tgl :global(.tgl-btn:active) {
    scale: 0.96;
  }
  .tgl :global(.tgl-btn[data-state='on']) {
    background: var(--accent-soft);
    color: var(--ink);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .tgl :global(.tgl-btn:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tgl :global(.tgl-btn:disabled) {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
