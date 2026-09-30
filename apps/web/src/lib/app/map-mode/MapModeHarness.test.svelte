<script lang="ts">
  /* Test harness: the real app keyboard dispatcher, two mappable controls, a text field and the
     real overlay, over a MapModeApi and a real ShellStore. */
  import AppKeyboardCapture from '../AppKeyboardCapture.svelte';
  import type { AppKeyboardStore } from '../app-keyboard';
  import type { ShellStore } from '../shell-store.svelte';
  import type { MapModeApi, MappableSpec } from '../../trigger-lab/map-api';
  import MapModeOverlay from './MapModeOverlay.svelte';
  import { mappable } from './mappable.svelte';
  import type { MapRegistry } from './registry.svelte';

  type Props = {
    api: MapModeApi;
    shell: ShellStore;
    registry: MapRegistry;
    cell: MappableSpec;
    fader: MappableSpec;
    onFire: () => void;
    store: AppKeyboardStore;
  };
  let { api, shell, registry, cell, fader, onFire, store }: Props = $props();
</script>

<AppKeyboardCapture {store} {shell} shortcuts={[]} shortcutPlatform="other" />
<button type="button" {@attach mappable(cell, registry)} onclick={onFire}>Kick cell</button>
<div role="slider" aria-label="Opacity" aria-valuenow={50} tabindex="0" {@attach mappable(fader, registry)}>fader</div>
<button type="button" onclick={onFire}>Unmappable</button>
<input aria-label="Name" />
<MapModeOverlay {api} {shell} {registry} />
