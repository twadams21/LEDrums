<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MarkerType,
    MiniMap,
    SvelteFlow,
    type Edge,
    type Node,
    type Connection,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { store } from '../store/app-store.svelte';
  import { buildRoutingGraph } from '../routing/build-routing-graph';

  type RoutingNode = Node<{ label: string; kind: string; detail: string }>;

  let { fullscreen = false } = $props<{ fullscreen?: boolean }>();

  const POSITIONS_KEY = 'ledrums-routing-positions';
  const EDGES_KEY = 'ledrums-routing-edges';
  const defaultEdgeOptions = {
    type: 'smoothstep',
    reconnectable: true,
    interactionWidth: 24,
    markerEnd: { type: MarkerType.ArrowClosed },
  };
  let nodes = $state.raw<RoutingNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let selectedNode = $state<RoutingNode | null>(null);

  const project = $derived(store.project);

  $effect(() => {
    if (!project) return;
    const graph = buildRoutingGraph(project, loadPositions());
    nodes = graph.nodes;
    edges = loadEdges() ?? graph.edges;
  });

  function loadPositions(): Record<string, { x: number; y: number }> {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}') as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  }

  function loadEdges(): Edge[] | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(EDGES_KEY);
      return raw ? (JSON.parse(raw) as Edge[]) : null;
    } catch {
      return null;
    }
  }

  function saveGraph(): void {
    if (typeof localStorage === 'undefined') return;
    const positions = Object.fromEntries(
      nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
    );
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    localStorage.setItem(EDGES_KEY, JSON.stringify(edges));
  }

  function selectNode({ node }: { node: RoutingNode }): void {
    selectedNode = node;
  }

  function recordConnect(_connection: Connection): void {
    queueMicrotask(saveGraph);
  }

  function recordReconnect(_edge: Edge, _connection: Connection): void {
    queueMicrotask(saveGraph);
  }

  function resetLayout(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(POSITIONS_KEY);
      localStorage.removeItem(EDGES_KEY);
    }
    if (!project) return;
    const graph = buildRoutingGraph(project);
    nodes = graph.nodes;
    edges = graph.edges;
    selectedNode = null;
  }
</script>

<section class="routing" class:fullscreen>
  {#if fullscreen}
    <header class="routebar">
      <div>
        <strong>Routing</strong>
        <span>{project?.name ?? 'No project'}</span>
      </div>
      <button onclick={() => store.setView('perform')}>Perform</button>
      <button onclick={() => store.setView('arrange')}>Arrange</button>
      <button onclick={() => store.setView('map')}>Map</button>
      <button onclick={resetLayout}>Reset Graph</button>
    </header>
  {/if}

  <div class="canvas">
    <SvelteFlow
      bind:nodes
      bind:edges
      fitView
      nodesDraggable
      nodesConnectable
      edgesFocusable
      connectionMode={ConnectionMode.Loose}
      {defaultEdgeOptions}
      onnodeclick={selectNode}
      onnodedragstop={saveGraph}
      onconnect={recordConnect}
      onreconnect={recordReconnect}
    >
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
    height: 100%;
  }
  .routing.fullscreen {
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-rows: 46px minmax(0, 1fr);
    gap: 0;
  }
  .routebar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .routebar div {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .routebar strong {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-size: 12px;
  }
  .routebar span {
    color: var(--text-dim);
  }
  .canvas {
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: #0a0d13;
  }
  .fullscreen .canvas {
    border: 0;
    border-radius: 0;
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    overflow: auto;
  }
  .fullscreen .panel {
    border-top: 0;
    border-right: 0;
    border-bottom: 0;
    border-radius: 0;
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
  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: var(--ok);
    stroke-width: 2.5;
  }
  :global(.svelte-flow__handle) {
    width: 10px;
    height: 10px;
    border: 1px solid var(--accent);
    background: #0d1118;
  }
</style>
