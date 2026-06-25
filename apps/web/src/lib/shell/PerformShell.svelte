<script lang="ts">
  /* Perform HUD — visualizer-forward, minimal chrome. The live surface for the
     performer: a live bar over an adjustable 50/50 split of the 3D stage and the
     2D pixel map. Per-layer 2D breakdown arrives with per-layer frames (slice 4). */
  import { store } from '../store/app-store.svelte';
  import Scene from '../visualizer/Scene.svelte';
  import Pixels2D from '../visualizer/Pixels2D.svelte';
  import Transport from '../panels/Transport.svelte';
  import LivePill from './LivePill.svelte';
  import StatusCluster from './StatusCluster.svelte';

  const offline = $derived(store.connection !== 'open');
  const projectName = $derived(store.project?.name ?? 'No project');

  let split = $state(50); // % width of the 3D pane
  let dragging = $state(false);
  let bodyEl = $state<HTMLDivElement | null>(null);

  function startDrag(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
  }
  function onDrag(e: PointerEvent): void {
    if (!dragging || !bodyEl) return;
    const rect = bodyEl.getBoundingClientRect();
    split = Math.max(28, Math.min(72, ((e.clientX - rect.left) / rect.width) * 100));
  }
  function endDrag(): void {
    dragging = false;
  }
  function nudge(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') split = Math.max(28, split - 2);
    else if (e.key === 'ArrowRight') split = Math.min(72, split + 2);
    else return;
    e.preventDefault();
  }
</script>

<div class="hud">
  <header class="livebar">
    <button class="mode" onclick={() => store.setMode('authoring')} title="Switch to authoring">
      <span class="mark" aria-hidden="true"></span>
      <span class="mode-text"><b>PERFORM</b><small>{projectName}</small></span>
    </button>

    <div class="transport-slot"><Transport /></div>

    <div class="bar-right">
      <LivePill />
      <StatusCluster />
    </div>
  </header>

  <div
    class="body"
    class:dragging
    bind:this={bodyEl}
    style="grid-template-columns: {split}fr 10px {100 - split}fr"
  >
    <section class="pane stage" aria-label="3D visualizer">
      <Scene model={store.model} frame={store.frame} dim={offline} />
      {#if offline}
        <div class="overlay">
          <span class="spin"></span>
          <span class="ov-text">
            {store.connection === 'connecting'
              ? `Connecting to engine${store.reconnectAttempt > 0 ? ` · retry ${store.reconnectAttempt}` : ''}`
              : 'Engine offline'}
          </span>
        </div>
      {/if}
      <span class="pane-tag">3D</span>
    </section>

    <div
      class="divider"
      role="slider"
      aria-orientation="vertical"
      aria-valuemin={28}
      aria-valuemax={72}
      aria-valuenow={Math.round(split)}
      aria-label="Resize 3D / 2D split"
      tabindex="0"
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onkeydown={nudge}
    >
      <span class="grip"></span>
    </div>

    <section class="pane flat" aria-label="2D pixel map">
      <Pixels2D model={store.model} frame={store.frame} />
      <span class="pane-tag">2D</span>
    </section>
  </div>
</div>

<style>
  .hud {
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: 54px minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-3);
    background:
      radial-gradient(140% 90% at 50% -10%, oklch(0.22 0.02 256 / 0.5), transparent 60%),
      var(--bg-perform);
    overflow: hidden;
  }

  /* ---- live bar ---- */
  .livebar {
    display: grid;
    grid-template-columns: minmax(180px, 0.8fr) minmax(0, 1.4fr) minmax(280px, 0.9fr);
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-2) 0 var(--space-1);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    height: 44px;
    padding: 0 var(--space-3);
    background: transparent;
    border: none;
    border-radius: 0;
  }
  .mode:hover {
    background: var(--surface-2);
  }
  .mark {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-1);
    background: conic-gradient(
      from 210deg,
      var(--role-input),
      var(--role-content),
      var(--role-effect),
      var(--role-layer),
      var(--role-output),
      var(--role-input)
    );
    box-shadow: var(--shadow-1);
    flex: none;
  }
  .mode-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
  }
  .mode-text b {
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .mode-text small {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .transport-slot {
    min-width: 0;
    display: flex;
    justify-content: center;
  }
  .bar-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
  }

  /* ---- split body ---- */
  .body {
    display: grid;
    min-height: 0;
  }
  .body.dragging {
    cursor: col-resize;
    user-select: none;
  }
  .pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--bg-perform);
  }
  .pane.flat {
    background: var(--surface);
  }
  .pane-tag {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    background: oklch(0.135 0.011 256 / 0.6);
    padding: 2px var(--space-2);
    border: 1px solid var(--border-faint);
    pointer-events: none;
  }

  .divider {
    position: relative;
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .divider:focus-visible {
    outline: none;
  }
  .grip {
    width: 2px;
    height: 56px;
    border-radius: var(--radius-pill);
    background: var(--border-strong);
    transform: scaleY(0.68);
    transition: background var(--dur-1) var(--ease-out-quart), transform var(--dur-1) var(--ease-out-quart);
  }
  .divider:hover .grip,
  .divider:focus-visible .grip {
    background: var(--accent);
    transform: scaleY(1);
  }

  /* ---- overlay ---- */
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    color: var(--text-muted);
    background: oklch(0.135 0.011 256 / 0.55);
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
  .ov-text {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .spin {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 1.6s;
    }
    .grip {
      transition: none;
    }
  }
</style>
