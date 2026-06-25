<script lang="ts">
  /* Authoring Workbench — dense, signal-flow-organised. Header · view rail ·
     workspace · right column (3D docked top + contextual inspector) · bottom
     layers strip. Re-homes the existing views/panels with new chrome. */
  import { store } from '../store/app-store.svelte';
  import Scene from '../visualizer/Scene.svelte';
  import Transport from '../panels/Transport.svelte';
  import LayerStack from '../panels/LayerStack.svelte';
  import EffectParams from '../panels/EffectParams.svelte';
  import ModulationMatrix from '../panels/ModulationMatrix.svelte';
  import ArrangeView from '../views/ArrangeView.svelte';
  import SettingsView from './SettingsView.svelte';
  import LivePill from './LivePill.svelte';
  import StatusCluster from './StatusCluster.svelte';
  import Icon from './Icon.svelte';

  type AuthView = 'arrange' | 'settings';
  let authView = $state<AuthView>('arrange');
  let dock3dOpen = $state(true);

  const offline = $derived(store.connection !== 'open');
  const projectName = $derived(store.project?.name ?? 'No project');
  const selectedClipName = $derived(
    store.selectedLayer?.clips.find((c) => c.id === store.selectedLayer?.activeClipId)?.name ?? null,
  );

  const nav: Array<{ id: AuthView; label: string; icon: string }> = [
    { id: 'arrange', label: 'Arrange', icon: 'arrange' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  // --- minimal project control (re-homed; full rebuild is slice 4) ---
  let loadSel = $state('');
  let saveName = $state('');
  $effect(() => {
    const n = store.project?.name;
    if (n && saveName === '') saveName = n;
  });
</script>

<div class="work">
  <header class="topbar">
    <button class="mode" onclick={() => store.setMode('performance')} title="Switch to perform">
      <span class="mark" aria-hidden="true"></span>
      <span class="mode-text"><b>AUTHOR</b><small>{projectName}</small></span>
    </button>

    <div class="project">
      <select bind:value={loadSel} aria-label="Load project">
        <option value="">load…</option>
        {#each store.projects as name (name)}<option value={name}>{name}</option>{/each}
      </select>
      <button onclick={() => loadSel && store.loadProject(loadSel)} disabled={!loadSel}>Load</button>
      <input class="savename" type="text" bind:value={saveName} placeholder="project name" spellcheck="false" aria-label="Save name" />
      <button onclick={() => store.saveProject((saveName || store.project?.name || 'Untitled').trim())}>Save</button>
    </div>

    <div class="transport-slot"><Transport /></div>

    <div class="bar-right">
      <LivePill />
      <StatusCluster />
    </div>
  </header>

  <div class="body">
    <nav class="rail" aria-label="View">
      {#each nav as v (v.id)}
        <button class="nav-item" class:active={authView === v.id} aria-pressed={authView === v.id} onclick={() => (authView = v.id)}>
          <Icon name={v.icon} size={18} />
          <span>{v.label}</span>
        </button>
      {/each}
    </nav>

    <main class="workspace">
      {#if authView === 'arrange'}
        <ArrangeView />
      {:else}
        <SettingsView />
      {/if}
    </main>

    <aside class="right">
      <section class="panel dock3d" class:collapsed={!dock3dOpen}>
        <header class="panel-head">
          <h2>Visualizer</h2>
          <button class="ghost icon-btn" onclick={() => (dock3dOpen = !dock3dOpen)} aria-label={dock3dOpen ? 'Collapse' : 'Expand'}>
            <Icon name={dock3dOpen ? 'chevron-down' : 'chevron-right'} size={14} />
          </button>
        </header>
        {#if dock3dOpen}
          <div class="viz-body">
            <Scene model={store.model} frame={store.frame} dim={offline} />
            {#if offline}<div class="viz-offline">Engine offline</div>{/if}
          </div>
        {/if}
      </section>

      <section class="panel inspector">
        <header class="panel-head">
          <h2>Inspector</h2>
          {#if selectedClipName}<span class="ctx">{selectedClipName}</span>{/if}
        </header>
        <div class="insp-body scroll">
          <div class="insp-group">
            <span class="insp-label"><Icon name="effect" size={13} /> Effect parameters</span>
            <EffectParams />
          </div>
          <div class="insp-group">
            <span class="insp-label"><Icon name="mod" size={13} /> Modulation</span>
            <ModulationMatrix />
          </div>
        </div>
      </section>
    </aside>
  </div>

  <section class="panel bottom">
    <header class="panel-head">
      <h2>Layers</h2>
      <span class="ctx">{store.project?.composition.layers.length ?? 0} in stack</span>
    </header>
    <div class="bottom-body scroll"><LayerStack /></div>
  </section>
</div>

<style>
  .work {
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: 50px minmax(0, 1fr) minmax(150px, 24vh);
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg);
    overflow: hidden;
  }

  /* ---- top bar ---- */
  .topbar {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-2) 0 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 48px;
    padding: 0 var(--space-3);
    background: transparent;
    border: none;
    border-right: 1px solid var(--border-faint);
    border-radius: var(--radius-card) 0 0 var(--radius-card);
  }
  .mode:hover {
    background: var(--surface-2);
  }
  .mark {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-2);
    background: conic-gradient(
      from 210deg,
      var(--role-input),
      var(--role-content),
      var(--role-effect),
      var(--role-layer),
      var(--role-output),
      var(--role-input)
    );
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
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .savename {
    width: 120px;
  }
  .transport-slot {
    min-width: 0;
    display: flex;
    justify-content: center;
  }
  .bar-right {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    justify-content: flex-end;
  }

  /* ---- body ---- */
  .body {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr) clamp(320px, 26vw, 392px);
    gap: var(--space-3);
    min-height: 0;
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .nav-item:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .nav-item.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  .nav-item.active :global(svg) {
    color: var(--accent);
  }

  .workspace {
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: var(--space-1);
  }

  /* ---- right column ---- */
  .right {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
  }
  .right .dock3d:not(.collapsed) {
    height: clamp(200px, 30vh, 280px);
  }
  .panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    min-height: 0;
    min-width: 0;
  }
  .dock3d.collapsed {
    grid-template-rows: auto;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .dock3d.collapsed .panel-head {
    border-bottom: none;
  }
  .panel-head h2 {
    flex: 1;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ctx {
    font-size: var(--text-2xs);
    color: var(--accent);
    font-family: var(--font-mono);
  }
  .icon-btn {
    padding: var(--space-1);
    color: var(--text-faint);
  }
  .viz-body {
    position: relative;
    min-height: 0;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    overflow: hidden;
    background: var(--bg-perform);
  }
  .viz-offline {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    font-size: var(--text-xs);
    pointer-events: none;
  }
  .inspector {
    min-height: 0;
  }
  .insp-body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .insp-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .insp-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .insp-label :global(svg) {
    color: var(--text-muted);
  }

  /* ---- bottom layers ---- */
  .bottom {
    min-height: 0;
  }
  .bottom-body {
    padding: var(--space-3);
    min-height: 0;
  }
  .scroll {
    overflow: auto;
  }
</style>
