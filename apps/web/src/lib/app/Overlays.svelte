<script lang="ts">
  /* Overlay layer — the summoned-on-demand drawers + modals (Effect Gallery,
     Clip / Graph Settings, Envelope Editor). Each reads its own open state off the
     engine store, so this is just a single mount point shared by both shells. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import EffectGallery from '../trigger-lab/EffectGallery.svelte';
  import ClipSettings from '../trigger-lab/ClipSettings.svelte';
  import EnvelopeEditor from '../trigger-lab/EnvelopeEditor.svelte';

  let { store }: { store: TriggerLab } = $props();
</script>

<EffectGallery {store} />
<ClipSettings {store} />
<EnvelopeEditor {store} />
