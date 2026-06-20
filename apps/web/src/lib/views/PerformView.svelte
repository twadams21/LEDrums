<script lang="ts">
  import { store } from '../store/app-store.svelte';
  import ClipGrid from '../panels/ClipGrid.svelte';
  import EffectParams from '../panels/EffectParams.svelte';
  import InputMonitor from '../panels/InputMonitor.svelte';
  import KitEditor from '../panels/KitEditor.svelte';
  import LayerStack from '../panels/LayerStack.svelte';
  import ModulationMatrix from '../panels/ModulationMatrix.svelte';
  import OutputConfig from '../panels/OutputConfig.svelte';
  import Transport from '../panels/Transport.svelte';

  const authoring = $derived(store.mode === 'authoring');
</script>

<section class="perform">
  <div class="panel prominent transport">
    <h2>Transport</h2>
    <Transport />
  </div>
  <div class="panel prominent layers">
    <h2>Layers</h2>
    <LayerStack />
  </div>
  <div class="panel clips">
    <h2>Clips</h2>
    <ClipGrid />
  </div>
  {#if authoring}
    <div class="panel recede params">
      <h2>Effect Parameters</h2>
      <EffectParams />
    </div>
    <div class="panel recede modulation">
      <h2>Modulation</h2>
      <ModulationMatrix />
    </div>
    <div class="panel recede output">
      <h2>Output</h2>
      <OutputConfig />
    </div>
    <div class="panel recede kit">
      <h2>Kit</h2>
      <KitEditor />
    </div>
    <div class="panel recede monitor">
      <h2>Input Monitor</h2>
      <InputMonitor />
    </div>
  {/if}
</section>

<style>
  .perform {
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(300px, 1.15fr) minmax(320px, 1.3fr);
    grid-auto-rows: min-content;
    gap: 10px;
    align-items: start;
    overflow: auto;
    min-height: 0;
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    min-width: 0;
  }
  .panel h2 {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-dim);
  }
  .panel.prominent {
    border-color: var(--border-bright);
    box-shadow: var(--shadow);
  }
  .panel.prominent h2 {
    color: var(--accent);
  }
  .panel.recede {
    background: rgba(13, 17, 24, 0.72);
    border-color: #1b2230;
  }
  .transport {
    grid-column: 1;
  }
  .layers {
    grid-column: 1;
  }
  .clips,
  .params,
  .modulation {
    grid-column: 2;
  }
  .output,
  .kit,
  .monitor {
    grid-column: 3;
  }
</style>
