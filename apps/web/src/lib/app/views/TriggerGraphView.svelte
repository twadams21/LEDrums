<script lang="ts">
  /* Trigger Graph view — the ACTIVE SECTION's flat graph list rail (replaces the old
     drum-grouped Play Surface) beside an @xyflow/svelte canvas (the same engine + look as
     the Patch graph). Click a graph in the rail to activate its section, open it on the
     canvas, and highlight it. The store stays the source of truth and
     autosaves, so every canvas edit flows through its mutators; the xyflow arrays are
     a derived projection (rebuilt on graph switch / structure change), with xyflow
     owning live node positions during a drag. All per-node editing lives in the
     right-dock Inspector — the nodes here are display-only. */
  import { setContext, untrack } from 'svelte';
  import type { Connection, EdgeTypes, NodeTypes } from '@xyflow/svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { NODE_KINDS, NODE_W, type GraphNode, type NodeKind } from '../../trigger-lab/sim';
  import { kindIcon, kindLabel, tint } from './trigger-node-meta';
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
  import GraphCanvas from './GraphCanvas.svelte';
  import GraphPalette from './GraphPalette.svelte';
  import GraphListRail from './GraphListRail.svelte';

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
  // The rail is the ACTIVE section's flat graph list: click a graph → it activates its
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

  // ---- add-node palette (shared GraphPalette) -------------------------------
  // One palette item per node kind (icon / tint / label from the shared node metadata).
  const PALETTE_ITEMS = NODE_KINDS.map((kind) => ({
    key: kind,
    label: kindLabel[kind],
    icon: kindIcon[kind],
    tint: tint[kind],
    title: `Add ${kindLabel[kind]} node`,
  }));
  /** Add a node through the store (source of truth) at the palette-supplied flow centre. */
  function addNodeAt(kind: NodeKind, cx: number, cy: number): void {
    store.addNode(kind, cx - NODE_W / 2, cy - 40);
  }

  // ---- xyflow projection of the store graph ---------------------------------
  let nodes = $state.raw<TriggerFlowNode[]>([]);
  let edges = $state.raw<TriggerFlowEdge[]>([]);

  /** Structure signatures — drive reactive rebuilds. Node positions are deliberately
      NOT in the node signature (a drag must not retrigger a rebuild mid-move); edge
      endpoints ARE, so a reconnect re-derives. */
  /** Per-node identity signature: kind plus a value+bands switch's handle-affecting shape
      (mode + band count). Drives reactive rebuilds AND decides which flow-node objects can be
      reused on re-projection — reuse keeps xyflow's measured handleBounds + live position, so a
      structure change to one node never makes every node drop its wires or snap position. */
  function nodeKey(n: GraphNode): string {
    return n.kind === 'switch'
      ? `${n.id}:switch:${n.on}:${n.valueMode}:${n.bands?.length ?? 0}`
      : `${n.id}:${n.kind}`;
  }
  const nodeSig = $derived((store.selectedGraph?.nodes ?? []).map(nodeKey).join('|'));
  const edgeSig = $derived(
    (store.selectedGraph?.edges ?? []).map((e) => `${e.id}:${e.from}>${e.to}`).join('|'),
  );
  const selectedNodeId = $derived(shell.selection?.kind === 'node' ? shell.selection.nodeId : null);

  /** Per-node signatures from the last projection — lets rebuildNodes reuse the existing
      flow-node object for structurally-unchanged nodes (see {@link nodeKey}). */
  const prevSig = new Map<string, string>();

  function rebuildNodes(): void {
    const g = store.selectedGraph;
    const selId = selectedNodeId;
    if (!g) {
      nodes = [];
      prevSig.clear();
      return;
    }
    // Reuse the existing flow-node object for any node whose structure AND selection are
    // unchanged, so xyflow keeps its measured handleBounds + live position. Rebuilding every
    // node from scratch made xyflow momentarily drop ALL edges (handleBounds lost until the
    // next measure) and re-apply store positions (snapping a node that was mid-edit) — the
    // "adding a node removes wires / moves the first play node" bug. Positions are read inside
    // untrack so only structure / selection / graph-switch rebuilds — never a position drag.
    nodes = untrack(() => {
      const prevById = new Map(nodes.map((n) => [n.id, n]));
      const next = graphToFlowNodes(g).map((fn, i) => {
        const sn = g.nodes[i]!; // graphToFlowNodes preserves g.nodes order
        const sig = nodeKey(sn);
        const wantSel = fn.id === selId;
        const prev = prevById.get(fn.id);
        if (prev && prevSig.get(fn.id) === sig && !!prev.selected === wantSel) return prev;
        return wantSel ? { ...fn, selected: true } : fn;
      });
      prevSig.clear();
      for (const sn of g.nodes) prevSig.set(sn.id, nodeKey(sn));
      return next;
    });
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
    store.selectedPadKey; // a switch hides the canvas until GraphFitView reports back
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
  <GraphListRail
    title={activeSection?.name ?? 'Section'}
    graphs={activeSection?.graphs ?? null}
    selectedKey={store.selectedPadKey}
    labelFor={(key) => store.graphLabel(key)}
    subFor={sourceSub}
    onOpen={openGraph}
    onNew={newGraph}
  />

  <GraphCanvas
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    fitPadding={0.2}
    fitWatch={store.selectedPadKey}
    onFitted={() => (fitted = true)}
    ready={!!store.selectedGraph}
    swapping={!fitted}
    onNodeClick={(id) => shell.select({ kind: 'node', nodeId: id })}
    onPaneClick={() => shell.clearSelection()}
    onNodeEnter={(id) => hover.enter(id)}
    onNodeLeave={() => hover.leave()}
    onNodeDragStop={({ nodes: moved }) => {
      for (const n of moved) syncPos(n);
    }}
    onConnect={onConnect}
    onConnectEnd={(event, conn) => {
      if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
      const toId = nodeIdAtEvent(event);
      if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, conn.fromHandle.id, toId);
    }}
    onReconnect={onReconnect}
    onDelete={({ edges: removed }) => onDeleteEdges(removed)}
  >
    {#snippet palette()}
      <GraphPalette items={PALETTE_ITEMS} add={addNodeAt} />
    {/snippet}
    {#snippet empty()}
      <p class="thint">Select a graph from the section to edit it.</p>
    {/snippet}
  </GraphCanvas>
</div>

<style>
  .trigger-view {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  /* the "select a graph" placeholder, centred by GraphCanvas's empty slot */
  .thint {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }
</style>
