<script
  lang="ts"
  generics="NodeType extends Node = Node, EdgeType extends Edge = Edge"
>
  /* Shared SvelteFlow workspace for the Patch + Trigger graphs (#9) — the duplicated
     <SvelteFlow> setup (Background / Controls / optional MiniMap, the post-layout
     re-fit, node/edge types, the project-token theming, and the hover/wiring event
     plumbing) lives here ONCE. Both views own their own node/edge state + interaction
     handlers and pass them down; the locked graph UX (no node lift / click motion,
     instant hover, drop-anywhere-on-node wiring) is identical. Adding happens in the
     Node Editor drawer beside the canvas (wave-3 shell) — `onFlow` hands the flow
     instance up so the view can place new nodes at the visible centre.

     Generic over the concrete node/edge types so each view keeps its typed arrays through
     the two-way `bind` (SvelteFlow owns live positions during a drag). */
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    SvelteFlow,
    type Connection,
    type Edge,
    type EdgeTypes,
    type Node,
    type NodeTypes,
    type OnConnectEnd,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { Snippet } from 'svelte';
  import GraphFitView from './GraphFitView.svelte';
  import FlowHandle, { type FlowApi } from './FlowHandle.svelte';

  type DragStop = { nodes: NodeType[] };
  type Drag = { targetNode: NodeType | null; nodes: NodeType[] };
  type DeleteDetail = { nodes: NodeType[]; edges: EdgeType[] };

  let {
    nodes = $bindable(),
    edges = $bindable(),
    nodeTypes,
    edgeTypes,
    fitPadding = 0.2,
    fitWatch,
    onFitted,
    minimap = false,
    swapping = false,
    ready = true,
    defaultEdgeOptions,
    onBeforeConnect,
    onNodeClick,
    onPaneClick,
    onNodeEnter,
    onNodeLeave,
    onConnect,
    onReconnect,
    onDelete,
    onNodeDragStop,
    onNodeDrag,
    onConnectEnd,
    onFlow,
    empty,
  }: {
    nodes: NodeType[];
    edges: EdgeType[];
    nodeTypes: NodeTypes;
    edgeTypes: EdgeTypes;
    /** fitView padding (initial boolean fit + the post-layout re-fit). */
    fitPadding?: number;
    /** Re-fit trigger — a graph switch passes the new graph key. */
    fitWatch?: unknown;
    onFitted?: () => void;
    /** Show the minimap (Patch graph only). */
    minimap?: boolean;
    /** Blank the flow while a graph switch re-fits (Trigger graph only). */
    swapping?: boolean;
    /** When false, render the `empty` snippet instead of the flow. */
    ready?: boolean;
    defaultEdgeOptions?: Record<string, unknown>;
    onBeforeConnect?: (c: Connection) => Connection | false;
    onNodeClick?: (id: string) => void;
    onPaneClick?: () => void;
    onNodeEnter?: (id: string) => void;
    onNodeLeave?: () => void;
    onConnect?: (c: Connection) => void;
    onReconnect?: (oldEdge: Edge, conn: Connection) => void;
    onDelete?: (detail: DeleteDetail) => void;
    onNodeDragStop?: (detail: DragStop) => void;
    onNodeDrag?: (detail: Drag) => void;
    onConnectEnd?: OnConnectEnd;
    /** Receives the flow instance once mounted — for view-side placement math. */
    onFlow?: (flow: FlowApi) => void;
    empty?: Snippet;
  } = $props();
</script>

<div class="gcanvas" class:swapping>
  {#if ready}
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      {edgeTypes}
      {defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: fitPadding }}
      nodesConnectable
      elevateNodesOnSelect={false}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      deleteKey={['Delete', 'Backspace']}
      onbeforeconnect={onBeforeConnect}
      onnodeclick={({ node }) => onNodeClick?.(node.id)}
      onpaneclick={() => onPaneClick?.()}
      onnodepointerenter={({ node }) => onNodeEnter?.(node.id)}
      onnodepointerleave={() => onNodeLeave?.()}
      onconnect={onConnect}
      onreconnect={onReconnect}
      ondelete={(detail) => onDelete?.(detail as DeleteDetail)}
      onnodedrag={(detail) => onNodeDrag?.(detail as Drag)}
      onnodedragstop={(detail) => onNodeDragStop?.(detail as DragStop)}
      onconnectend={onConnectEnd}
    >
      <GraphFitView padding={fitPadding} watch={fitWatch} onfitted={onFitted} />
      {#if onFlow}<FlowHandle onflow={onFlow} />{/if}
      <Background variant={BackgroundVariant.Dots} />
      <Controls />
      {#if minimap}<MiniMap />{/if}
    </SvelteFlow>
  {:else if empty}
    <div class="gempty">{@render empty()}</div>
  {/if}
</div>

<style>
  .gcanvas {
    position: relative;
    min-height: 0;
    min-width: 0;
    height: 100%;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
    /* matches the flow bg so a graph-switch swap blank shows no colour blink */
    background: var(--bg-perform);
  }
  .gempty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  /* --- @xyflow/svelte on the project tokens (shared theming) ----------------- */
  .gcanvas :global(.svelte-flow) {
    background: var(--bg-perform);
  }
  /* during a graph switch, hide the flow until it's re-fitted (no flash, instant) */
  .gcanvas.swapping :global(.svelte-flow) {
    opacity: 0;
  }
  /* custom nodes bring their own card — strip xyflow's default node chrome */
  .gcanvas :global(.svelte-flow__node-patch),
  .gcanvas :global(.svelte-flow__node-trigger) {
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
  .gcanvas :global(.svelte-flow__node-patch.selected),
  .gcanvas :global(.svelte-flow__node-trigger.selected) {
    box-shadow: none;
  }
  .gcanvas :global(.svelte-flow__edge-path) {
    stroke: var(--border-strong);
    stroke-width: 1.6;
  }
  /* The invisible wide hit-path BaseEdge renders (`interactionWidth`) has no stroke paint by
     default — and the edge wrapper hit-tests with `pointer-events: visibleStroke`, which never
     hits an unpainted stroke. Paint it transparent so the generous hit area actually works
     (the "some wires are unselectable" bug); the visual stroke above is untouched. */
  .gcanvas :global(.svelte-flow__edge-interaction) {
    stroke: transparent;
    stroke-opacity: 0;
  }
  /* modifier-chain wires read distinctly from trigger-flow wires: the mod role colour +
     a dashed stroke, so the two flows separate at a glance (declared BEFORE edge-hot so the
     hover accent still wins the stroke on a hovered mod wire; the dash stays either way) */
  .gcanvas :global(.svelte-flow__edge.edge-mod .svelte-flow__edge-path) {
    stroke: var(--role-mod);
    stroke-dasharray: 5 4;
  }
  /* modulation wires (source→param) get the third wire role colour + a finer dotted stroke, so
     they read distinctly from both trigger-flow and modifier-chain wires at a glance */
  .gcanvas :global(.svelte-flow__edge.edge-modulation .svelte-flow__edge-path) {
    stroke: var(--role-modulation);
    stroke-dasharray: 2 3;
  }
  .gcanvas :global(.svelte-flow__edge.edge-effect .svelte-flow__edge-path) {
    stroke: var(--role-mod);
  }
  /* a wire one level connected to the hovered node lights up (see graph-hover) */
  .gcanvas :global(.svelte-flow__edge.edge-hot .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  .gcanvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path),
  .gcanvas :global(.svelte-flow__edge:hover .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  /* the `mod` input handle — mod role colour so it reads as the modifier port, not flow in */
  .gcanvas :global(.svelte-flow__handle.mod-handle) {
    background: color-mix(in oklch, var(--role-mod) 30%, var(--surface-2));
    border-color: var(--role-mod);
  }
  .gcanvas :global(.svelte-flow__handle.mod-handle:hover),
  .gcanvas :global(.svelte-flow__handle.mod-handle.connectingto) {
    background: var(--role-mod);
    border-color: var(--role-mod);
  }
  .gcanvas :global(.svelte-flow__handle.trigger-handle) {
    background: color-mix(in oklch, var(--accent) 28%, var(--surface-2));
    border-color: var(--accent);
  }
  .gcanvas :global(.svelte-flow__handle.effect-handle) {
    background: color-mix(in oklch, var(--role-mod) 28%, var(--surface-2));
    border-color: var(--role-mod);
  }
  .gcanvas :global(.svelte-flow__handle.param-handle) {
    background: color-mix(in oklch, var(--role-modulation) 30%, var(--surface-2));
    border-color: var(--role-modulation);
  }
  /* editable: handles are grabbable wiring affordances (accent on hover / wiring) */
  .gcanvas :global(.svelte-flow__handle) {
    width: 10px;
    height: 10px;
    background: var(--surface-2);
    border: 1.5px solid var(--border-strong);
  }
  .gcanvas :global(.svelte-flow__handle)::after {
    content: '';
    position: absolute;
    inset: -20px;
    border-radius: 50%;
  }
  .gcanvas :global(.svelte-flow__handle:hover),
  .gcanvas :global(.svelte-flow__handle.connectingfrom),
  .gcanvas :global(.svelte-flow__handle.connectingto) {
    background: var(--accent);
    border-color: var(--accent);
  }
  /* the in-progress connection line */
  .gcanvas :global(.svelte-flow__connectionline .svelte-flow__connection-path) {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  } 
  .gcanvas :global(.svelte-flow__controls) {
    background: var(--surface);
    padding: var(--space-1);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }
  .gcanvas :global(.svelte-flow__controls-button) {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    color: var(--text-muted);
    fill: currentColor;
  }
  .gcanvas :global(.svelte-flow__controls-button:hover) {
    background: var(--surface-2);
    color: var(--ink);
  }
  .gcanvas :global(.svelte-flow__minimap) {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .gcanvas :global(.svelte-flow__minimap-mask) {
    fill: color-mix(in oklch, var(--bg) 62%, transparent);
  }
</style>
