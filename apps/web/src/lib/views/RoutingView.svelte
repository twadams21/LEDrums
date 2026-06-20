<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    SvelteFlow,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { store } from '../store/app-store.svelte';
  import { buildRoutingGraph } from '../routing/build-routing-graph';

  type RoutingNode = Node<{ label: string; kind: string; detail: string }>;

  const STORAGE_KEY = 'ledrums-routing-positions';
  let nodes = $state.raw<RoutingNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let selectedNode = $state<RoutingNode | null>(null);

  const project = $derived(store.project);

  $effect(() => {
    if (!project) return;
    const graph = buildRoutingGraph(project, loadPositions());
    nodes = graph.nodes;
    edges = graph.edges;
  });

  function loadPositions(): Record<string, { x: number; y: number }> {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  }

  function savePositions(): void {
    if (typeof localStorage === 'undefined') return;
    const positions = Object.fromEntries(
      nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }

  function selectNode({ node }: { node: RoutingNode }): void {
    selectedNode = node;
  }
</script>

<section class="routing">
  <div class="canvas">
    <SvelteFlow bind:nodes bind:edges fitView onnodeclick={selectNode} onnodedragstop={savePositions}>
      <Controls />
      <MiniMap />
      <Background variant={BackgroundVariant.Dots} />
    </SvelteFlow>
  </div>

  <aside class="panel">
    <h2>Node Settings</h2>
    {#if selectedNode}
      <div class="settings">
        <label>
          <span>Name</span>
          <input value={selectedNode.data.label} readonly />
        </label>
        <label>
          <span>Type</span>
          <input value={selectedNode.data.kind} readonly />
        </label>
        <label>
          <span>Route</span>
          <input value={selectedNode.data.detail} readonly />
        </label>
      </div>
    {:else}
      <p class="empty">Select a node to inspect its current settings.</p>
    {/if}
    <p class="note">
      Graph layout is persisted in localStorage. Project routing remains source-of-truth in the kit and input map for this MVP.
    </p>
  </aside>
</section>

<style>
  .routing {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 10px;
    min-height: 0;
  }
  .canvas {
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: #0a0d13;
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    overflow: auto;
  }
  h2 {
    margin: 0 0 10px 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--accent);
  }
  .settings {
    display: grid;
    gap: 8px;
  }
  label {
    display: grid;
    gap: 4px;
    color: var(--text-dim);
  }
  input {
    width: 100%;
  }
  .empty,
  .note {
    color: var(--text-dim);
    line-height: 1.4;
  }
  .note {
    margin-top: 16px;
    font-size: 12px;
  }
  :global(.svelte-flow) {
    background: #0a0d13;
  }
  :global(.svelte-flow__node) {
    background: var(--panel-raised);
    color: var(--text);
    border: 1px solid var(--border-bright);
    border-radius: 8px;
    font-size: 12px;
    box-shadow: var(--shadow);
  }
  :global(.svelte-flow__node-input) {
    border-color: var(--accent);
  }
  :global(.svelte-flow__node-output) {
    border-color: var(--ok);
  }
  :global(.svelte-flow__edge-path) {
    stroke: var(--accent);
  }
</style>
