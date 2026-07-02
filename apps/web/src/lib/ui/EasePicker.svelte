<script lang="ts" module>
  import type { EaseFn, EaseDir, EaseSpec } from '../trigger-lab/sim';

  /** The Resolume-familiar easing families, grouped for a compact selector.
      Single-sourced so the EnvelopeEditor (S24) and the Envelope node inspector
      (S34) label eases identically. */
  export const EASE_FAMILY_OPTIONS: { value: EaseFn; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'sine', label: 'Sine' },
    { value: 'quad', label: 'Quad' },
    { value: 'cubic', label: 'Cubic' },
    { value: 'quart', label: 'Quart' },
    { value: 'expo', label: 'Expo' },
    { value: 'circ', label: 'Circ' },
    { value: 'back', label: 'Back' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'elastic', label: 'Elastic' },
  ];

  export const EASE_DIR_OPTIONS: { value: EaseDir; label: string }[] = [
    { value: 'in', label: 'In' },
    { value: 'out', label: 'Out' },
    { value: 'inOut', label: 'In·Out' },
  ];

  export type { EaseSpec };
</script>

<script lang="ts">
  /* Compact ease selector: a family Select paired with an In/Out/In·Out direction
     control. Family-grouped so the full 10×3 Resolume set stays legible. `linear`
     is identical in every direction, so the direction control is disabled (not
     hidden — no layout shift) when Linear is chosen. Pure props: pass `value` +
     `onChange`; the caller owns the EaseSpec. Reused by the EnvelopeEditor and the
     Envelope node inspector (S34). */
  import Select from './Select.svelte';
  import SegmentedControl from './SegmentedControl.svelte';

  type Props = {
    value: EaseSpec;
    onChange: (spec: EaseSpec) => void;
    /** Labels the pair for assistive tech, e.g. "Attack easing". */
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
  };

  let { value, onChange, ariaLabel, disabled = false, class: klass }: Props = $props();

  const isLinear = $derived(value.fn === 'linear');

  function pickFamily(fn: string): void {
    onChange({ fn: fn as EaseFn, dir: value.dir });
  }
  function pickDir(dir: string): void {
    onChange({ fn: value.fn, dir: dir as EaseDir });
  }
</script>

<div class={['ease-picker', klass]} role="group" aria-label={ariaLabel}>
  <Select
    value={value.fn}
    options={EASE_FAMILY_OPTIONS}
    onChange={pickFamily}
    {disabled}
    ariaLabel={ariaLabel ? `${ariaLabel} — family` : 'Easing family'}
    class="ease-family"
  />
  <SegmentedControl
    value={value.dir}
    options={EASE_DIR_OPTIONS}
    onChange={pickDir}
    disabled={disabled || isLinear}
    ariaLabel={ariaLabel ? `${ariaLabel} — direction` : 'Easing direction'}
    class="ease-dir"
  />
</div>

<style>
  .ease-picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .ease-picker :global(.ease-family) {
    flex: 1;
    min-width: 0;
  }
  .ease-picker :global(.ease-dir) {
    flex: none;
  }
</style>
