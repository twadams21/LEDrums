<script lang="ts">
  /* Test harness: the real Effects grid and device strip under the real map-mode overlay, over
     the standalone authoring api and an in-memory MapModeApi (the store implements it later). */
  import type { EffectsAuthoringApi } from '../../../trigger-lab/effects-api';
  import type { MapModeApi } from '../../../trigger-lab/map-api';
  import type { ShellStore } from '../../shell-store.svelte';
  import MapModeOverlay from '../../map-mode/MapModeOverlay.svelte';
  import EffectsGrid from './grid/EffectsGrid.svelte';
  import DeviceStrip from './strip/DeviceStrip.svelte';

  let { api, mapApi, shell }: { api: EffectsAuthoringApi; mapApi: MapModeApi; shell: ShellStore } = $props();
</script>

<EffectsGrid {api} />
<DeviceStrip {api} cell={api.selectedCell} />
<MapModeOverlay api={mapApi} {shell} />
