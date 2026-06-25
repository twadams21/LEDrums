<script lang="ts">
  /* Trigger Graph view — the Play Surface rail (triggers grouped by drum; pick one to
     edit its graph, fire it to preview) beside an @xyflow/svelte canvas (the same
     engine + look as the Patch graph). The store stays the source of truth and
     autosaves, so every canvas edit flows through its mutators; the xyflow arrays are
     a derived projection (rebuilt on graph switch / structure change), with xyflow
     owning live node positions during a drag. All per-node editing lives in the
     right-dock Inspector — the nodes here are display-only. */
  import { setContext, untrack } from 'svelte';
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    Panel,
    SvelteFlow,
    type Connection,
    type EdgeTypes,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Pad } from '../../trigger-lab/fixtures';
  import {
    graphToFlowEdges,
    graphToFlowNodes,
    type TriggerFlowEdge,
    type TriggerFlowNode,
  } from './graph-to-flow';
  import { GraphHover } from './graph-hover.svelte';
  import { TRIGGER_STORE_KEY } from './trigger-context';
  import TriggerNode from './TriggerNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import TriggerPalette from './TriggerPalette.svelte';
  import TriggerFitView from './TriggerFitView.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // hand the live store down to the xyflow custom nodes (they read their model by id).
  // The store is a stable class instance for the component's life — capturing it once
  // is intended, so read it through untrack to keep the compiler from flagging it.
  setContext(
    TRIGGER_STORE_KEY,
    untrack(() => store),
  );

  const nodeTypes: NodeTypes = { trigger: TriggerNode };
  const edgeTypes: EdgeTypes = { wire: WireEdge };
  const hover = new GraphHover();

  const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;

  // ---- Play Surface rail ----------------------------------------------------
  function pick(p: Pad): void {
    store.selectedPadKey = padKey(p);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
  function pickKey(key: string): void {
    store.selectedPadKey = key;
    shell.clearSelection();
  }
  function newGraph(): void {
    store.createGraph();
    shell.clearSelection();
  }

  // ---- xyflow projection of the store graph ---------------------------------
  let nodes = $state.raw<TriggerFlowNode[]>([]);
  let edges = $state.raw<TriggerFlowEdge[]>([]);

  /** Structure signatures — drive reactive rebuilds. Node positions are deliberately
      NOT in the node signature (a drag must not retrigger a rebuild mid-move); edge
      endpoints ARE, so a reconnect re-derives. */
  const nodeSig = $derived((store.selectedGraph?.nodes ?? []).map((n) => `${n.id}:${n.kind}`).join('|'));
  const edgeSig = $derived(
    (store.selectedGraph?.edges ?? []).map((e) => `${e.id}:${e.from}>${e.to}`).join('|'),
  );
  const selectedNodeId = $derived(shell.selection?.kind === 'node' ? shell.selection.nodeId : null);

  function rebuildNodes(): void {
    const g = store.selectedGraph;
    const selId = selectedNodeId;
    // positions read inside untrack so only structure / selection / graph-switch
    // rebuild — never a position-only drag.
    nodes = g
      ? untrack(() =>
          graphToFlowNodes(g).map((n) => (n.id === selId ? { ...n, selected: true } : n)),
        )
      : [];
  }
  function rebuildEdges(): void {
    const g = store.selectedGraph;
    edges = hover.decorate(g ? untrack(() => graphToFlowEdges(g)) : []);
  }

  // node array: rebuild on graph switch, structure change, or selection change
  $effect(() => {
    store.selectedPadKey;
    nodeSig;
    selectedNodeId;
    rebuildNodes();
  });
  // edge array: rebuild on graph switch, edge change, or hover (highlight)
  $effect(() => {
    store.selectedPadKey;
    edgeSig;
    hover.hoveredId;
    rebuildEdges();
  });

  // ---- canvas interactions (all flow through the store) ---------------------
  function syncPos(fn: { id: string; position: { x: number; y: number } }): void {
    const sn = store.selectedGraph?.nodes.find((n) => n.id === fn.id);
    if (sn) store.moveNode(sn, fn.position.x, fn.position.y);
  }
  function onConnect(c: Connection): void {
    store.connect(c.source, c.target); // store validates (dup / cycle / direction)
    rebuildEdges(); // drop any edge xyflow added optimistically that the store rejected
  }
  function onReconnect(oldEdge: { id: string }, c: Connection): void {
    store.reconnect(oldEdge.id, c.source, c.target);
    rebuildEdges(); // revert the anchor's optimistic move if the store rejected it
  }
  function onDeleteEdges(removed: ReadonlyArray<{ id: string }>): void {
    for (const e of removed) store.disconnect(e.id);
    rebuildEdges();
  }
</script>

<div class="trigger-view">
  <aside class="surface">
    <header class="shead"><Eyebrow>Play Surface</Eyebrow></header>
    <div class="scroll">
      {#each store.drums as drum (drum.id)}
        {@const pads = store.pads.filter((p) => p.drumId === drum.id)}
        <div class="group">
          <div class="ghead">{drum.label}</div>
          {#each pads as p (padKey(p))}
            <div class="trig" class:active={store.selectedPadKey === padKey(p)}>
              <button class="trig-main" onclick={() => pick(p)}>
                <span class="zone">{p.zoneLabel}</span>
                <span class="root">{p.tree.kind}</span>
              </button>
              <IconButton icon={Play} label="Fire {drum.label} {p.zoneLabel}" size={13} onclick={() => store.hit(p)} />
            </div>
          {/each}
        </div>
      {/each}

      <div class="group">
        <div class="ghead">Authored</div>
        {#each store.authoredGraphs as g (g.key)}
          <div class="trig" class:active={store.selectedPadKey === g.key}>
            <button class="trig-main" onclick={() => pickKey(g.key)}>
              <span class="zone">{g.label}</span>
              <span class="root">graph</span>
            </button>
          </div>
        {/each}
        <button class="newgraph" type="button" onclick={newGraph}>
          <Plus size={13} aria-hidden="true" /> New graph
        </button>
      </div>
    </div>
  </aside>

  <section class="canvas">
    {#if store.selectedGraph}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable
        minZoom={0.2}
        deleteKey={['Delete', 'Backspace']}
        onnodeclick={({ node }) => shell.select({ kind: 'node', nodeId: node.id })}
        onpaneclick={() => shell.clearSelection()}
        onnodepointerenter={({ node }) => (nodes = hover.enter(node.id, nodes))}
        onnodepointerleave={() => (nodes = hover.leave(nodes))}
        onnodedragstart={() => (nodes = hover.dragStart(nodes))}
        onnodedragstop={({ nodes: moved }) => {
          hover.dragStop();
          for (const n of moved) syncPos(n);
        }}
        onconnect={onConnect}
        onreconnect={onReconnect}
        ondelete={({ edges: removed }) => onDeleteEdges(removed)}
      >
        <TriggerFitView padding={0.2} watch={store.selectedPadKey} />
        <Panel position="top-left"><TriggerPalette {store} /></Panel>
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap />
      </SvelteFlow>
    {:else}
      <p class="hint">Select a pad to edit its trigger graph.</p>
    {/if}
  </section>
</div>

<style>
  .trigger-view {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .surface {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .shead {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .scroll {
    overflow: auto;
    min-height: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .group {
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    padding: var(--space-2);
    background: var(--surface-inset);
  }
  .ghead {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    padding: 0 var(--space-1) var(--space-1);
  }
  .trig {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-1);
  }
  .trig.active {
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    background: var(--accent-soft);
  }
  .trig-main {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2);
    background: transparent;
    border: none;
    text-align: left;
    min-width: 0;
  }
  .trig-main:hover .zone {
    color: var(--ink);
  }
  .zone {
    font-size: var(--text-sm);
    color: var(--text);
    text-transform: capitalize;
  }
  .trig.active .zone {
    color: var(--ink);
  }
  .root {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--accent);
    text-transform: uppercase;
  }
  .newgraph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    margin-top: var(--space-1);
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .newgraph:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .newgraph:active {
    scale: 0.98;
  }
  @media (prefers-reduced-motion: reduce) {
    .newgraph {
      transition: none;
    }
  }
  .canvas {
    position: relative;
    min-height: 0;
    min-width: 0;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .hint {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }

  /* --- @xyflow/svelte on the project tokens (shared theming with PatchGraphView) -- */
  .canvas :global(.svelte-flow) {
    background: var(--bg-perform);
  }
  /* custom `trigger` nodes bring their own card — strip xyflow's default chrome */
  .canvas :global(.svelte-flow__node-trigger) {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    width: auto;
    box-shadow: none;
    color: inherit;
    font-family: inherit;
  }
  /* the selection ring is drawn by the node card itself (NodeCard .card.sel) */
  .canvas :global(.svelte-flow__node-trigger.selected) {
    box-shadow: none;
  }
  .canvas :global(.svelte-flow__edge-path) {
    stroke: var(--border-strong);
    stroke-width: 1.6;
  }
  .canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path),
  .canvas :global(.svelte-flow__edge:hover .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  /* a wire one level connected to the hovered node lights up (see graph-hover) */
  .canvas :global(.svelte-flow__edge.edge-hot .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  /* editable: handles are grabbable wiring affordances (accent on hover / wiring) */
  .canvas :global(.svelte-flow__handle) {
    width: 8px;
    height: 8px;
    background: var(--surface-2);
    border: 1.5px solid var(--border-strong);
  }
  .canvas :global(.svelte-flow__handle:hover),
  .canvas :global(.svelte-flow__handle.connectingfrom),
  .canvas :global(.svelte-flow__handle.connectingto) {
    background: var(--accent);
    border-color: var(--accent);
  }
  /* the in-progress connection line */
  .canvas :global(.svelte-flow__connectionline .svelte-flow__connection-path) {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  }
  .canvas :global(.svelte-flow__controls) {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }
  .canvas :global(.svelte-flow__controls-button) {
    background: var(--surface);
    border-bottom: 1px solid var(--border-faint);
    color: var(--text-muted);
    fill: currentColor;
  }
  .canvas :global(.svelte-flow__controls-button:hover) {
    background: var(--surface-2);
    color: var(--ink);
  }
  .canvas :global(.svelte-flow__minimap) {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .canvas :global(.svelte-flow__minimap-mask) {
    fill: color-mix(in oklch, var(--bg) 62%, transparent);
  }
  .canvas :global(.svelte-flow__attribution) {
    background: color-mix(in oklch, var(--surface) 70%, transparent);
    color: var(--text-faint);
  }
  .canvas :global(.svelte-flow__attribution a) {
    color: var(--text-muted);
  }
</style>
