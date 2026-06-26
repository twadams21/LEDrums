<script lang="ts">
  /* Trigger Graph view — the ACTIVE SECTION's flat graph list rail (U4; replaces the old
     drum-grouped Play Surface) beside an @xyflow/svelte canvas (the same engine + look as
     the Patch graph). Click a graph in the rail to activate its section, open it on the
     canvas, and highlight it. The store stays the source of truth and
     autosaves, so every canvas edit flows through its mutators; the xyflow arrays are
     a derived projection (rebuilt on graph switch / structure change), with xyflow
     owning live node positions during a drag. All per-node editing lives in the
     right-dock Inspector — the nodes here are display-only. */
  import { setContext, untrack } from 'svelte';
  import {
    Background,
    BackgroundVariant,
    Controls,
    Panel,
    SvelteFlow,
    type Connection,
    type EdgeTypes,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import {
    graphToFlowEdges,
    graphToFlowNodes,
    type TriggerFlowEdge,
    type TriggerFlowNode,
  } from './graph-to-flow';
  import { GraphHover } from './graph-hover.svelte';
  import { nodeIdAtEvent } from './flow-dom';
  import { TRIGGER_STORE_KEY } from './trigger-context';
  import { describeTriggerSource } from '../trigger-source-label';
  import TriggerNode from './TriggerNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import TriggerPalette from './TriggerPalette.svelte';
  import TriggerFitView from './TriggerFitView.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
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

  // ---- active section's graph list (replaces the old drum-grouped Play Surface) ----
  // The rail is the ACTIVE section's flat graph list (U4): click a graph → it activates its
  // section, opens on the canvas, and highlights here. Selecting + opening is one store call.
  const activeSection = $derived(store.activeSection);

  function openGraph(key: string): void {
    const id = store.activeSectionId;
    if (id) store.selectGraphInSection(id, key);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
  /** The graph's trigger-source sub line (e.g. "Kick · center", "MIDI note 38", "unbound"). */
  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }
  /** Author a new graph, add it to the active section, and open it for editing. */
  function newGraph(): void {
    const key = store.createGraph();
    if (store.activeSectionId) store.addGraphToSection(store.activeSectionId, key);
    shell.clearSelection();
  }

  // ---- xyflow projection of the store graph ---------------------------------
  let nodes = $state.raw<TriggerFlowNode[]>([]);
  let edges = $state.raw<TriggerFlowEdge[]>([]);

  /** Structure signatures — drive reactive rebuilds. Node positions are deliberately
      NOT in the node signature (a drag must not retrigger a rebuild mid-move); edge
      endpoints ARE, so a reconnect re-derives. */
  const nodeSig = $derived(
    (store.selectedGraph?.nodes ?? [])
      .map((n) =>
        // a value+bands switch's handle COUNT depends on its mode + band count — fold
        // that into the signature so adding/removing a band rebuilds the node and xyflow
        // re-measures its handles (a position-only drag still never rebuilds).
        n.kind === 'switch' ? `${n.id}:switch:${n.on}:${n.valueMode}:${n.bands?.length ?? 0}` : `${n.id}:${n.kind}`,
      )
      .join('|'),
  );
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

  // Hide the canvas content while a graph switch re-fits, so the new graph never
  // flashes at the previous graph's viewport — revealed instantly once fitted.
  let fitted = $state(false);
  $effect(() => {
    store.selectedPadKey; // a switch hides the canvas until TriggerFitView reports back
    fitted = false;
  });

  // ---- canvas interactions (all flow through the store) ---------------------
  function syncPos(fn: { id: string; position: { x: number; y: number } }): void {
    const sn = store.selectedGraph?.nodes.find((n) => n.id === fn.id);
    if (sn) store.moveNode(sn, fn.position.x, fn.position.y);
  }
  function onConnect(c: Connection): void {
    store.connect(c.source, c.target, c.sourceHandle ?? undefined); // store validates (dup / cycle / direction)
    rebuildEdges(); // drop any edge xyflow added optimistically that the store rejected
  }
  function onReconnect(oldEdge: { id: string }, c: Connection): void {
    store.reconnect(oldEdge.id, c.source, c.target, c.sourceHandle ?? undefined);
    rebuildEdges(); // revert the anchor's optimistic move if the store rejected it
  }
  function onDeleteEdges(removed: ReadonlyArray<{ id: string }>): void {
    for (const e of removed) store.disconnect(e.id);
    rebuildEdges();
  }
  /** A wire dropped on a node body (not a handle): wire it to that node's input — or
      its output if the drag began at an input. `store.connect` validates direction /
      cycle / dup, so a drop that can't be accepted is simply ignored. When the drag
      began at a source handle, carry its id (a switch band) so the band wire lands. */
  function dropConnect(
    fromId: string,
    fromType: 'source' | 'target' | null,
    fromPort: string | null | undefined,
    toId: string,
  ): void {
    if (fromId === toId) return;
    if (fromType === 'target') store.connect(toId, fromId);
    else store.connect(fromId, toId, fromPort ?? undefined);
    rebuildEdges();
  }
</script>

<div class="trigger-view">
  <aside class="surface">
    <header class="shead">
      <Eyebrow>{activeSection?.name ?? 'Section'}</Eyebrow>
    </header>
    <div class="scroll">
      {#if activeSection}
        {#each activeSection.graphs as key (key)}
          <button class="trig" class:active={store.selectedPadKey === key} onclick={() => openGraph(key)}>
            <span class="glabel">{store.graphLabel(key)}</span>
            <span class="gsub">{sourceSub(key)}</span>
          </button>
        {/each}
        {#if activeSection.graphs.length === 0}
          <p class="empty">No graphs in this section.</p>
        {/if}
        <button class="newgraph" type="button" onclick={newGraph}>
          <Plus size={13} aria-hidden="true" /> New graph
        </button>
      {:else}
        <p class="empty">No active section.</p>
      {/if}
    </div>
  </aside>

  <section class="canvas" class:swapping={!fitted}>
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
        proOptions={{ hideAttribution: true }}
        deleteKey={['Delete', 'Backspace']}
        onnodeclick={({ node }) => shell.select({ kind: 'node', nodeId: node.id })}
        onpaneclick={() => shell.clearSelection()}
        onnodepointerenter={({ node }) => hover.enter(node.id)}
        onnodepointerleave={() => hover.leave()}
        onnodedragstop={({ nodes: moved }) => {
          for (const n of moved) syncPos(n);
        }}
        onconnect={onConnect}
        onconnectend={(event, conn) => {
          if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
          const toId = nodeIdAtEvent(event);
          if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, conn.fromHandle.id, toId);
        }}
        onreconnect={onReconnect}
        ondelete={({ edges: removed }) => onDeleteEdges(removed)}
      >
        <TriggerFitView padding={0.2} watch={store.selectedPadKey} onfitted={() => (fitted = true)} />
        <Panel position="top-left"><TriggerPalette {store} /></Panel>
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
      </SvelteFlow>
    {:else}
      <p class="hint">Select a graph from the section to edit it.</p>
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
  .trig {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
    padding: var(--space-2);
    text-align: left;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
    transition: border-color 120ms ease, background-color 120ms ease;
  }
  .trig:hover {
    border-color: var(--border-strong);
  }
  .trig:hover .glabel {
    color: var(--ink);
  }
  .trig.active {
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    background: var(--accent-soft);
  }
  .glabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    font-size: var(--text-sm);
    color: var(--text);
  }
  .trig.active .glabel {
    color: var(--ink);
  }
  .gsub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
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
    /* matches the flow bg so the brief swap blank shows no colour blink */
    background: var(--bg-perform);
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
  /* during a graph switch, hide the flow until it's re-fitted (no flash, instant) */
  .canvas.swapping :global(.svelte-flow) {
    opacity: 0;
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
</style>
