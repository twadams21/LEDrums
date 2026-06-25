<script lang="ts">
  /* Sliding on/off switch on Bits UI. Distinct from Toggle (a labelled button) —
     use for boolean settings. `checked` is bindable. */
  import { Switch } from 'bits-ui';

  type Props = {
    checked: boolean;
    onChange?: (v: boolean) => void;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let { checked = $bindable(false), onChange, disabled = false, ariaLabel, class: klass }: Props = $props();
</script>

<span class={['sw', klass]}>
  <Switch.Root bind:checked onCheckedChange={onChange} {disabled} aria-label={ariaLabel} class="sw-root">
    <Switch.Thumb class="sw-thumb" />
  </Switch.Root>
</span>

<style>
  .sw {
    display: inline-flex;
  }
  .sw :global(.sw-root) {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 36px;
    height: 20px;
    padding: 2px;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill, 999px);
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease;
  }
  .sw :global(.sw-root[data-state='checked']) {
    background: var(--accent);
    border-color: var(--accent-bright);
  }
  .sw :global(.sw-root:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .sw :global(.sw-thumb) {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: var(--shadow-1);
    translate: 0 0;
    transition: translate 140ms cubic-bezier(0.2, 0, 0, 1), background-color 140ms ease;
  }
  .sw :global(.sw-root[data-state='checked'] .sw-thumb) {
    translate: 16px 0;
    background: var(--on-accent);
  }
  .sw :global(.sw-root[data-disabled]) {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
