<script lang="ts">
  /* Settings › General — app-wide settings without a more specific pane home.
     Updates live in System, MIDI/OSC input in Input (S4e); what remains here is
     the global control bindings. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import GlobalControlsPanel from '../../chrome/GlobalControlsPanel.svelte';

  let { store }: { store: TriggerLab } = $props();
</script>

<div class="pane-body">
  <h3>General</h3>
  <GlobalControlsPanel {store} />
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
</style>
