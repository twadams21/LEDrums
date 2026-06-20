<script lang="ts">
  import { store } from '../store/app-store.svelte';

  const projectName = $derived(store.project?.name ?? '—');
  let selected = $state('');
  let saveName = $state('');

  // Default the load picker + save name to the current project.
  $effect(() => {
    const name = store.project?.name;
    if (name && saveName === '') saveName = name;
  });

  function load(): void {
    if (selected) store.loadProject(selected);
  }
  function save(): void {
    const name = (saveName || store.project?.name || 'Untitled').trim();
    if (name) store.saveProject(name);
  }
  function newProject(): void {
    // No dedicated "new" message; load a fresh default if present, else save-as.
    if (store.projects.includes('default')) store.loadProject('default');
  }
</script>

<header class="bar">
  <div class="brand">
    <span class="logo">LED<b>rums</b></span>
    <span class="proj" title="Current project">{projectName}</span>
  </div>

  <div class="modes" role="group" aria-label="Mode">
    <button
      class:active={store.mode === 'performance'}
      aria-pressed={store.mode === 'performance'}
      onclick={() => store.setMode('performance')}
    >
      Performance
    </button>
    <button
      class:active={store.mode === 'authoring'}
      aria-pressed={store.mode === 'authoring'}
      onclick={() => store.setMode('authoring')}
    >
      Authoring
    </button>
  </div>

  <div class="files">
    <select bind:value={selected} aria-label="Project to load">
      <option value="">load…</option>
      {#each store.projects as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
    <button onclick={load} disabled={!selected}>Load</button>
    <input
      class="savename"
      type="text"
      bind:value={saveName}
      placeholder="project name"
      spellcheck="false"
      aria-label="Save name"
    />
    <button onclick={save}>Save</button>
    <button onclick={newProject} title="Reset to default project">New</button>
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 44px;
    padding: 0 12px;
    background: var(--panel);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    z-index: 20;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .logo {
    font-weight: 800;
    letter-spacing: -0.5px;
    font-size: 16px;
  }
  .logo b {
    color: var(--accent);
    font-weight: 800;
  }
  .proj {
    color: var(--text-dim);
    font-size: 12px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modes {
    display: flex;
    gap: 0;
    margin-left: 4px;
  }
  .modes button {
    border-radius: 0;
  }
  .modes button:first-child {
    border-radius: 5px 0 0 5px;
  }
  .modes button:last-child {
    border-radius: 0 5px 5px 0;
    border-left: none;
  }
  .files {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .savename {
    width: 130px;
  }
</style>
