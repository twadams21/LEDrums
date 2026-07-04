<script lang="ts">
  /* Kit-global mirror control (S11) on the Patch view toolbar. Mirror is a geometry-only world
     reflection (none/x/y) applied to the whole model — kit-wide, not per-drum, so it lives on the
     toolbar rather than a drum inspector. Applies live via store.setKitMirror and persists with the
     project. Composes the design-system SegmentedControl (scale-on-press / focus ring built in). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';

  let { store }: { store: TriggerLab } = $props();

  const mirror = $derived(store.project?.kit.global.mirror ?? 'none');

  const OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
  ];
</script>

<div class="mirror">
  <span class="mlabel">Mirror</span>
  <SegmentedControl
    value={mirror}
    options={OPTIONS}
    ariaLabel="Kit mirror axis"
    disabled={!store.canEdit}
    onChange={(v) => store.setKitMirror(v as 'none' | 'x' | 'y')}
  />
</div>

<style>
  .mirror {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    min-width: 0;
  }
  .mlabel {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    white-space: nowrap;
  }
</style>
