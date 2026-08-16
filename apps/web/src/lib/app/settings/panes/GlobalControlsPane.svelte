<script lang="ts">
  /* Settings › Global controls — the app-general MIDI/OSC bindings (next song, tap tempo,
     …), split out of the Input pane. `GlobalControlsPanel` is reused wholesale from its
     chrome path: it owns the catalogue-driven rows, both Learn arms per row, the heard
     badges and the zone-collision warning. Closing the modal disarms whatever it armed
     (SettingsModal's close path), unchanged by the move. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import GlobalControlsPanel from '../../chrome/GlobalControlsPanel.svelte';
  import PaneHeader from '../PaneHeader.svelte';

  let { store }: { store: TriggerLab } = $props();
</script>

<div class="pane-body">
  <PaneHeader id="controls" />
  <GlobalControlsPanel {store} />
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  /* The panel labels itself ("Global controls · app-general MIDI / OSC") because it used to
     sit mid-column under Input; as a whole pane the header above already says it. Hidden,
     not removed — the panel is reused in place and its <section aria-label> still names it. */
  .pane-body :global(.gc > .glabel) {
    display: none;
  }
</style>
