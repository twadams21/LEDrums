<script lang="ts">
  import { onMount } from 'svelte';
  import { store, type PrimaryView } from './lib/store/app-store.svelte';
  import Scene from './lib/visualizer/Scene.svelte';
  import ProjectBar from './lib/panels/ProjectBar.svelte';
  import StatusBar from './lib/panels/StatusBar.svelte';
  import Transport from './lib/panels/Transport.svelte';
  import ArrangeView from './lib/views/ArrangeView.svelte';
  import MapView from './lib/views/MapView.svelte';
  import PerformView from './lib/views/PerformView.svelte';
  import RoutingView from './lib/views/RoutingView.svelte';

  const views: Array<{ id: PrimaryView; label: string }> = [
    { id: 'perform', label: 'Perform' },
    { id: 'arrange', label: 'Arrange' },
    { id: 'map', label: 'Map' },
    { id: 'routing', label: 'Routing' },
  ];

  let renderCollapsed = $state(false);
  let renderX = $state(18);
  let renderY = $state(92);
  let renderW = $state(420);
  let renderH = $state(320);
  let drag = $state<{ dx: number; dy: number } | null>(null);
  let resize = $state<{ x: number; y: number; w: number; h: number } | null>(null);

  const disconnected = $derived(store.connection !== 'open');

  onMount(() => {
    void store.start();
    return () => store.stop();
  });

  function beginDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    drag = { dx: event.clientX - renderX, dy: event.clientY - renderY };
  }

  function beginResize(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    resize = { x: event.clientX, y: event.clientY, w: renderW, h: renderH };
  }

  function moveWindow(event: PointerEvent): void {
    if (drag) {
      renderX = Math.max(8, Math.min(window.innerWidth - 180, event.clientX - drag.dx));
      renderY = Math.max(54, Math.min(window.innerHeight - 80, event.clientY - drag.dy));
    }
    if (resize) {
      renderW = Math.max(280, Math.min(760, resize.w + event.clientX - resize.x));
      renderH = Math.max(190, Math.min(620, resize.h + event.clientY - resize.y));
    }
  }

  function endPointer(): void {
    drag = null;
    resize = null;
  }
</script>

{#if store.view === 'routing'}
  <div class="routing-page">
    <RoutingView fullscreen />
  </div>
{:else}
  <div
    class="app"
    role="application"
    onpointermove={moveWindow}
    onpointerup={endPointer}
    onpointercancel={endPointer}
  >
    <header class="topbar">
      <ProjectBar />
      <div class="compact-transport">
        <Transport />
      </div>
      <StatusBar />
    </header>

    <nav class="switcher" aria-label="Primary view">
      {#each views as view (view.id)}
        <button
          class:active={store.view === view.id}
          aria-pressed={store.view === view.id}
          onclick={() => store.setView(view.id)}
        >
          {view.label}
        </button>
      {/each}
    </nav>

    <main class="workspace">
      {#if store.view === 'perform'}
        <PerformView />
      {:else if store.view === 'arrange'}
        <ArrangeView />
      {:else}
        <MapView />
      {/if}
    </main>

    <section
      class="render-window"
      class:collapsed={renderCollapsed}
      style={`left:${renderX}px; top:${renderY}px; width:${renderW}px; height:${renderCollapsed ? 34 : renderH}px;`}
    >
      <div class="render-title" role="button" tabindex="0" onpointerdown={beginDrag}>
        <span>Renderer</span>
        <button onclick={() => (renderCollapsed = !renderCollapsed)}>
          {renderCollapsed ? 'Open' : 'Hide'}
        </button>
      </div>
      {#if !renderCollapsed}
        <div class="render-body">
          <Scene model={store.model} frame={store.frame} dim={disconnected} />
          {#if disconnected}
            <div class="overlay">
              <span class="spin"></span>
              <span>
                {store.connection === 'connecting'
                  ? `Connecting${store.reconnectAttempt > 0 ? ` retry ${store.reconnectAttempt}` : ''}`
                  : 'Engine offline'}
              </span>
            </div>
          {/if}
        </div>
        <button class="resize" aria-label="Resize renderer" onpointerdown={beginResize}></button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .app {
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: 48px 42px minmax(0, 1fr);
    background: var(--bg);
    overflow: hidden;
  }
  .routing-page {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--bg);
  }
  .topbar {
    display: grid;
    grid-template-columns: minmax(430px, 1fr) 300px minmax(260px, 0.7fr);
    align-items: stretch;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    z-index: 20;
  }
  .topbar :global(header.bar),
  .topbar :global(footer.bar) {
    height: 47px;
    border: 0;
    background: transparent;
    backdrop-filter: none;
  }
  .topbar :global(footer.bar) {
    justify-content: flex-end;
  }
  .compact-transport {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 10px;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
  .compact-transport :global(.transport) {
    width: 100%;
  }
  .switcher {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 7px 12px;
    background: #0b0f16;
    border-bottom: 1px solid var(--border);
  }
  .switcher button {
    min-width: 92px;
    border-radius: 0;
  }
  .switcher button:first-child {
    border-radius: 5px 0 0 5px;
  }
  .switcher button:last-child {
    border-radius: 0 5px 5px 0;
    border-left: none;
  }
  .workspace {
    min-height: 0;
    min-width: 0;
    padding: 12px;
    overflow: hidden;
  }
  .render-window {
    position: absolute;
    z-index: 30;
    display: grid;
    grid-template-rows: 34px minmax(0, 1fr);
    background: var(--panel-solid);
    border: 1px solid var(--border-bright);
    border-radius: 8px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .render-window.collapsed {
    width: 180px !important;
  }
  .render-title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 7px 5px 10px;
    background: #111722;
    border-bottom: 1px solid var(--border);
    cursor: move;
    user-select: none;
  }
  .render-title span {
    flex: 1;
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .render-title button {
    padding: 3px 7px;
  }
  .render-body {
    position: relative;
    min-height: 0;
  }
  .render-body :global(canvas) {
    display: block;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-dim);
    background: rgba(7, 9, 13, 0.48);
    pointer-events: none;
  }
  .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--accent-dim);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: linear-gradient(135deg, transparent 45%, var(--border-bright) 46%, var(--border-bright) 55%, transparent 56%);
    cursor: nwse-resize;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
