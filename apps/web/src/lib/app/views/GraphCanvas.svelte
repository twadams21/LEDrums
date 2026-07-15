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
  import WireDragValidity, { type WireDragFrom } from './WireDragValidity.svelte';

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
    snapGrid,
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
    validateDrag,
    wirePreview,
    overlay,
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
    /** Snap dragged nodes to a grid (px). When set, the background dots align to the same grid so
        the snap targets are visible. Omitted → free positioning (the Trigger graph). */
    snapGrid?: [number, number];
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
    /** In-drag validity predicate (R03): true when dropping the wire-in-progress on the given
        node/handle would be accepted. When provided, the wire-in-progress turns red / dotted /
        dull over an invalid target. Omitted by graphs that don't need connection-time feedback. */
    validateDrag?: (from: WireDragFrom, toNodeId: string, toHandleId: string | null) => boolean;
    /** Dev/ui-shot only: pin a static invalid-wire line (canvas-local px) so the otherwise
        drag-only red/dotted/dull state can be screenshotted. Inert in production. */
    wirePreview?: { x1: number; y1: number; x2: number; y2: number } | null;
    /** Extra content rendered INSIDE the flow (has flow/viewport context) — e.g. the alignment
        guide overlay drawn in flow coordinates via ViewportPortal. */
    overlay?: Snippet;
    empty?: Snippet;
  } = $props();

  // In-drag invalid-target state (R03): the tracker flips this as the pointer crosses targets.
  let dragInvalid = $state(false);
</script>

<div class="gcanvas" class:swapping class:wire-invalid={dragInvalid || !!wirePreview}>
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
      {snapGrid}
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
      {#if validateDrag}
        <WireDragValidity validate={validateDrag} onChange={(v) => (dragInvalid = v)} />
      {/if}
      <Background variant={BackgroundVariant.Dots} gap={snapGrid ?? 20} />
      <Controls />
      {#if minimap}<MiniMap />{/if}
      {@render overlay?.()}
    </SvelteFlow>
    {#if wirePreview}
      <!-- ui-shot only: a static stand-in for the drag-only connection line, wearing the same
           xyflow classes so the `.wire-invalid` styling below paints it identically — zero visual
           duplication. Dev-only callers pin it; production never passes `wirePreview`. -->
      <svg class="svelte-flow__connectionline wire-preview" aria-hidden="true">
        <path
          class="svelte-flow__connection-path"
          fill="none"
          d={`M ${wirePreview.x1},${wirePreview.y1} C ${wirePreview.x1 + 70},${wirePreview.y1} ${
            wirePreview.x2 - 70
          },${wirePreview.y2} ${wirePreview.x2},${wirePreview.y2}`}
        />
      </svg>
    {/if}
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
  /* zone container nodes paint their own dashed holder — strip xyflow chrome but KEEP the sized
     box (width/height come from the node), and never let a zone intercept a leaf's pointer events
     except on its own visible chrome. */
  .gcanvas :global(.svelte-flow__node-zone) {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: inherit;
    font-family: inherit;
  }
  .gcanvas :global(.svelte-flow__node-zone.selected) {
    box-shadow: none;
  }
  /* the greyed, dotted, non-interactive Trigger → Drum reference wire (D1) — stays grey (never
     lights on hover/selection: it is decoration, not a signal wire). */
  .gcanvas :global(.svelte-flow__edge.edge-ref .svelte-flow__edge-path) {
    stroke: var(--wire-ref, var(--border));
    stroke-width: 1.5;
    stroke-dasharray: 3 5;
  }
  .gcanvas :global(.svelte-flow__edge.edge-ref) {
    pointer-events: none;
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
  /* modifier-chain wires read distinctly from trigger-flow wires by their dashed stroke alone:
     the wire itself stays grey (signal-flow wires are intentionally de-coloured), so only the
     dash separates the modifier chain from the trigger flow at a glance. */
  .gcanvas :global(.svelte-flow__edge.edge-mod .svelte-flow__edge-path) {
    stroke-dasharray: 5 4;
  }
  /* modulation wires (source→param) are the one coloured flow — a value routed into a parameter
     is a genuinely different wire from signal flow, so it keeps the modulation role colour + a
     finer dotted stroke to read distinctly from the grey trigger/modifier wires. */
  .gcanvas :global(.svelte-flow__edge.edge-modulation .svelte-flow__edge-path) {
    stroke: var(--role-modulation);
    stroke-dasharray: 2 3;
  }
  /* a directly hovered or selected wire lights up accent (the instant-hover interaction
     contract); signal-flow wires otherwise read grey. */
  .gcanvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path),
  .gcanvas :global(.svelte-flow__edge:hover .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  /* Reconnect grab dots. The reconnect anchor (and this dot) render in xyflow's `edge-labels`
     PORTAL — NOT inside `.svelte-flow__edge` — so they can't key off edge hover/selection. Show
     them ALWAYS as a subtle affordance at each wire end (a small grey dot marking "grab here to
     re-point"), brightening to accent when the 25px anchor itself is hovered. Centred in the
     anchor hit-box; the anchor stays grabbable regardless. No motion (locked graph contract). */
  .gcanvas :global(.svelte-flow__edgeupdater) {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  }
  .gcanvas :global(.reconnect-dot) {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 2px solid var(--border-strong);
    box-shadow: var(--shadow-1);
    opacity: 0.6;
  }
  .gcanvas :global(.svelte-flow__edgeupdater:hover .reconnect-dot) {
    opacity: 1;
    border-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 25%, var(--surface-2));
  }
  /* R08: a wire ARMED for a splice (a node is dragged over it) lights accent, thickens, and
     glows — the pending insert reads clearly BEFORE release. Instant, no motion (the locked
     graph-interaction contract). Wins over the grey/hover strokes via later cascade + weight. */
  .gcanvas :global(.svelte-flow__edge.edge-splice-armed .svelte-flow__edge-path) {
    stroke: var(--accent);
    stroke-width: 3;
    filter: drop-shadow(0 0 4px color-mix(in oklch, var(--accent) 60%, transparent));
  }
  /* the modulation ports keep the modulation role colour so they read by role: the param
     INPUT (`param-handle`) and the modulation-source OUTPUT (`mod-source-handle`). Both carry
     the `.svelte-flow__handle` + role class, so this two-class selector outweighs the neutral
     grey base rule below (which the source handle's own scoped rule only tied on specificity).
     The trigger / effect / mod flow handles stay the neutral grey handle below. */
  .gcanvas :global(.svelte-flow__handle.param-handle),
  .gcanvas :global(.svelte-flow__handle.mod-source-handle) {
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
  /* Over an INVALID drop target the wire-in-progress reads red, dotted, and dull the moment the
     pointer crosses it (item 1.1) — the refusal is announced before release, never a wire that
     silently vanishes. `--live-bright` is the same red the error toast uses, so the in-drag cue
     and the reason toast read as one signal. */
  .gcanvas.wire-invalid :global(.svelte-flow__connectionline .svelte-flow__connection-path) {
    stroke: var(--live-bright);
    stroke-dasharray: 2 3;
    opacity: 0.45;
  }
  /* ui-shot only: the pinned static stand-in fills the canvas so its path lands in flow space. */
  .gcanvas :global(svg.wire-preview) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    z-index: 5;
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
