<script lang="ts">
  /* Kit view — the 3D kit geometry. This milestone renders the live kit (the real
     pixel model + composite) so you can see the rig; the geometry editor (per-drum
     transforms · hoops · spin · start angle) lands with its own slice. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Scene from '../../visualizer/Scene.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Box from '@lucide/svelte/icons/box';

  let { store }: { store: TriggerLab } = $props();

  const previewFrame = $derived(
    store.link === 'open' && store.serverFrame ? store.serverFrame : store.frameBuf,
  );
</script>

<div class="kit-view">
  <header class="head">
    <Eyebrow icon={Box}>Kit geometry</Eyebrow>
    <span class="hint">{store.drums.length} drums · {store.model.count} pixels · transform / hoop / spin editing arrives in its slice</span>
  </header>
  <section class="stage">
    <Scene model={store.model} frame={previewFrame} />
  </section>
</div>

<style>
  .kit-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .stage {
    min-height: 0;
    overflow: hidden;
    background: var(--bg-perform);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
</style>
