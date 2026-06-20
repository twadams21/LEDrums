<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './lib/store/app-store.svelte';
  import Scene from './lib/visualizer/Scene.svelte';
  import ProjectBar from './lib/panels/ProjectBar.svelte';
  import StatusBar from './lib/panels/StatusBar.svelte';
  import Transport from './lib/panels/Transport.svelte';
  import LayerStack from './lib/panels/LayerStack.svelte';
  import ClipGrid from './lib/panels/ClipGrid.svelte';
  import EffectParams from './lib/panels/EffectParams.svelte';
  import ModulationMatrix from './lib/panels/ModulationMatrix.svelte';
  import OutputConfig from './lib/panels/OutputConfig.svelte';
  import KitEditor from './lib/panels/KitEditor.svelte';
  import InputMonitor from './lib/panels/InputMonitor.svelte';

  let dockOpen = $state(true);

  const authoring = $derived(store.mode === 'authoring');
  const disconnected = $derived(store.connection !== 'open');

  onMount(() => {
    void store.start();
    return () => store.stop();
  });
</script>

<div class="app">
  <Scene model={store.model} frame={store.frame} dim={disconnected} />

  {#if disconnected}
    <div class="overlay">
      <div class="ocard">
        <span class="spin"></span>
        {store.connection === 'connecting'
          ? `Connecting to engine${store.reconnectAttempt > 0 ? `… retry ${store.reconnectAttempt}` : '…'}`
          : 'Engine offline — retrying'}
      </div>
    </div>
  {/if}

  <ProjectBar />

  <button
    class="dock-toggle"
    class:closed={!dockOpen}
    onclick={() => (dockOpen = !dockOpen)}
    aria-label={dockOpen ? 'Collapse panels' : 'Expand panels'}
  >
    {dockOpen ? '⟩' : '⟨'}
  </button>

  {#if dockOpen}
    <aside class="dock">
      <!-- Performance-prominent panels first. -->
      <div class="panel prominent">
        <h2>Transport</h2>
        <Transport />
      </div>

      <div class="panel prominent">
        <h2>Layers</h2>
        <LayerStack />
      </div>

      <div class="panel">
        <h2>Clips</h2>
        <ClipGrid />
      </div>

      {#if authoring}
        <div class="panel recede">
          <h2>Effect Parameters</h2>
          <EffectParams />
        </div>
        <div class="panel recede">
          <h2>Modulation</h2>
          <ModulationMatrix />
        </div>
        <div class="panel recede setup">
          <h2>Output</h2>
          <OutputConfig />
        </div>
        <div class="panel recede setup">
          <h2>Kit</h2>
          <KitEditor />
        </div>
        <div class="panel recede">
          <h2>Input Monitor</h2>
          <InputMonitor />
        </div>
      {/if}
    </aside>
  {/if}

  <StatusBar />
</div>

<style>
  .app {
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: auto 1fr auto;
    overflow: hidden;
  }
  /* ProjectBar (row 1) and StatusBar (row 3) sit above the full-bleed Scene. */
  .app > :global(header.bar) {
    grid-row: 1;
  }
  .app > :global(footer.bar) {
    grid-row: 3;
  }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .ocard {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    background: var(--panel);
    border: 1px solid var(--border-bright);
    border-radius: 8px;
    color: var(--text-dim);
    box-shadow: var(--shadow);
  }
  .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--accent-dim);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .dock-toggle {
    position: absolute;
    top: 54px;
    right: 0;
    z-index: 15;
    width: 22px;
    height: 40px;
    border-radius: 6px 0 0 6px;
    border-right: none;
    background: var(--panel);
  }
  .dock-toggle.closed {
    right: 0;
  }

  .dock {
    position: absolute;
    top: 44px;
    right: 0;
    bottom: 28px;
    width: 340px;
    z-index: 10;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 12px 12px;
    background: var(--panel);
    backdrop-filter: blur(10px);
    border-left: 1px solid var(--border);
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
  }
  .panel h2 {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-dim);
  }
  /* Visual hierarchy: Transport + Layers are loud; setup panels recede. */
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
  .panel.recede.setup h2 {
    color: var(--text-faint);
  }
</style>
