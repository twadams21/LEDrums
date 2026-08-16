<script lang="ts">
  /* Overlay layer — the summoned-on-demand drawers + modals (Effect Gallery,
     Clip / Graph Settings, Envelope Editor) plus the window-right Inspector
     slideover. Each reads its own open state off the engine store (the slideover
     off the shell selection), so this is just a single mount point shared by both
     shells. Mounting here is what lets the slideover paint above the docks and
     chrome bars instead of inside a view's grid. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import EffectGallery from '../trigger-lab/EffectGallery.svelte';
  import ClipSettings from '../trigger-lab/ClipSettings.svelte';
  import EnvelopeEditor from '../trigger-lab/EnvelopeEditor.svelte';
  import InspectorSlideover from './InspectorSlideover.svelte';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();
</script>

<InspectorSlideover {store} {shell} />
<EffectGallery {store} />
<ClipSettings {store} />
<EnvelopeEditor {store} />
