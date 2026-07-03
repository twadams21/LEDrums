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
  import type { Connection, EdgeTypes, NodeTypes, OnConnectEnd } from '@xyflow/svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { NODE_KINDS, NODE_W, type NodeKind } from '../../trigger-lab/sim';
  import type { ToPort } from '../../trigger-lab/store/graph-wiring';
  import { voice } from '@ledrums/core';
  import { kindIcon, kindLabel, tint } from './trigger-node-meta';
  import {
    graphToFlowEdges,
    type TriggerFlowEdge,
    type TriggerFlowNode,
  } from './graph-to-flow';
  import {
    emptyTriggerProjectionCache,
    projectionDesyncIds,
    projectTriggerFlowNodes,
    resetProjectionCache,
    triggerNodeSignature,
    type TriggerProjectionCache,
  } from './trigger-flow-projection';
  import { GraphHover } from './graph-hover.svelte';
  import { nodeIdAtEvent } from './flow-dom';
  import { guardFlowCallback } from './flow-guard';
  import { TRIGGER_STORE_KEY } from './trigger-context';
  import { describeTriggerSource } from '../trigger-source-label';
  import TriggerNode from './TriggerNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import GraphPalette from './GraphPalette.svelte';
  import ModifierPalette from './ModifierPalette.svelte';
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
    projectionCache = resetProjectionCache(); // graph-open: never reuse the old graph's signatures
    if (id) store.selectGraphInSection(id, key);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
  /** The graph's trigger-source sub line (e.g. "Kick · center", "MIDI D2", "unbound"). */
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
  // The generic `modifier` kind is served by the dedicated ModifierPalette below (which lists
  // every registered modifier by category), so it's dropped from the flat kind palette.
  // Flow-node kinds only. `modifier` is served by ModifierPalette (by category); `envelope` +
  // the other modulation sources are grouped into their own palette below.
  const PALETTE_ITEMS = NODE_KINDS.filter((kind) => kind !== 'modifier' && !voice.isModSourceKind(kind)).map((kind) => ({
    key: kind,
    label: kindLabel[kind],
    icon: kindIcon[kind],
    tint: tint[kind],
    title: `Add ${kindLabel[kind]} node`,
  }));
  // Modulation sources (doc 10) — their own palette group (Envelope now; LFO/CC in S36/S37).
  const MODULATION_ITEMS = NODE_KINDS.filter((kind) => voice.isModSourceKind(kind)).map((kind) => ({
    key: kind,
    label: kindLabel[kind],
    icon: kindIcon[kind],
    tint: tint[kind],
    title: `Add ${kindLabel[kind]} modulation source`,
  }));
  /** Add a node through the store (source of truth) at the palette-supplied flow centre. */
  function addNodeAt(kind: NodeKind, cx: number, cy: number): void {
    store.addNode(kind, cx - NODE_W / 2, cy - 40);
  }
  /** Add a specific modifier node (category palette) at the palette-supplied flow centre. */
  function addModifierNodeAt(modifierId: string, cx: number, cy: number): void {
    store.addModifierNode(modifierId, cx - NODE_W / 2, cy - 40);
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
  const nodeSig = $derived((store.selectedGraph?.nodes ?? []).map(triggerNodeSignature).join('|'));
  const edgeSig = $derived(
    (store.selectedGraph?.edges ?? []).map((e) => `${e.id}:${e.from}>${e.to}`).join('|'),
  );
  const selectedNodeId = $derived(shell.selection?.kind === 'node' ? shell.selection.nodeId : null);

  /** Per-node signatures from the last projection — lets rebuildNodes reuse the existing
      flow-node object for structurally-unchanged nodes (see triggerNodeSignature). */
  let projectionCache: TriggerProjectionCache = emptyTriggerProjectionCache();

  /** Report a graph-editor fault: console for the dev, plus a Monitor `error` event so a
      live-show failure is visible in the timeline instead of silently corrupting the canvas
      (incident 09). */
  function reportGraphFault(where: string, err: unknown): void {
    const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
    console.error(`[trigger-graph] ${where} failed`, err);
    store.reportError('trigger-graph', where, detail);
  }

  /** Self-heal after a fault: drop the projection cache and rebuild nodes + edges from the
      store (the source of truth). A thrown callback then heals in place instead of leaving a
      stale / blank canvas until a page refresh (incident 09, candidates 1 & 2). */
  function forceRebuild(): void {
    projectionCache = resetProjectionCache();
    rebuildNodes();
    rebuildEdges();
  }

  /** Wrap an xyflow event callback so a throw becomes a reported fault + a self-healing
      rebuild, never a silently corrupted canvas (incident 09, candidate 2: an uncaught throw
      inside a handler breaks Svelte's effect tracking and freezes the node array). The
      boundary itself is {@link guardFlowCallback} (pure, unit-tested); this binds the view's
      fault + recovery to it. */
  function guard<A extends unknown[]>(where: string, fn: (...args: A) => void): (...args: A) => void {
    return guardFlowCallback(where, fn, (w, err) => {
      reportGraphFault(w, err);
      forceRebuild();
    });
  }

  function rebuildNodes(): void {
    const g = store.selectedGraph;
    const graphKey = store.selectedPadKey;
    const selId = selectedNodeId;
    if (!g) {
      nodes = [];
      projectionCache = emptyTriggerProjectionCache();
      return;
    }
    // Reuse the existing flow-node object for any node whose structure AND selection are
    // unchanged, so xyflow keeps its measured handleBounds + live position. Rebuilding every
    // node from scratch made xyflow momentarily drop ALL edges (handleBounds lost until the
    // next measure) and re-apply store positions (snapping a node that was mid-edit) — the
    // "adding a node removes wires / moves the first play node" bug. Positions are read inside
    // untrack so only structure / selection / graph-switch rebuilds — never a position drag.
    nodes = untrack(() => {
      // New graph → drop the previous graph's cache BEFORE projecting, so a throw can never
      // leave stale signatures a later projection reuses against the wrong graph (candidate 1).
      if (graphKey !== projectionCache.graphKey) projectionCache = resetProjectionCache();
      try {
        const projected = projectTriggerFlowNodes({
          graph: g,
          graphKey,
          selectedNodeId: selId,
          previousNodes: nodes,
          cache: projectionCache,
        });
        projectionCache = projected.cache; // write-through ONLY on success (exception-safe)
        if (import.meta.env.DEV) {
          const missing = projectionDesyncIds(
            projected.nodes.map((n) => n.id),
            g.nodes.map((n) => n.id),
          );
          if (missing.length) {
            console.error(
              '[trigger-graph] projection desync — rendered flow-node ids missing from the store graph',
              {
                missing,
                cacheGraphKey: projectionCache.graphKey,
                currentGraphKey: graphKey,
                flowNodeIds: projected.nodes.map((n) => n.id),
                graphNodeIds: g.nodes.map((n) => n.id),
              },
            );
          }
        }
        return projected.nodes;
      } catch (err) {
        // Projection threw: reset the cache so the NEXT rebuild is a clean full rebuild (never
        // reuse stale signatures) and keep the last-good render — a blank canvas is the exact
        // failure we are preventing. A follow-up rebuild (structure change / forceRebuild)
        // then re-projects cleanly.
        projectionCache = resetProjectionCache();
        reportGraphFault('projection', err);
        return nodes;
      }
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
  /** The target handle id (`mod`, a `param:<key>` modulation row, or the default flow input)
      as a store `toPort`. A dropped param handle must pass through so its mapping edge lands. */
  function toPortOf(handle: string | null | undefined): ToPort {
    if (handle === 'mod') return 'mod';
    return handle && voice.paramKeyOf(handle as ToPort) !== null ? (handle as `param:${string}`) : undefined;
  }
  function onConnect(c: Connection): void {
    // store validates (dup / cycle / direction / port scoping)
    store.connect(c.source, c.target, c.sourceHandle ?? undefined, toPortOf(c.targetHandle));
    rebuildEdges(); // drop any edge xyflow added optimistically that the store rejected
  }
  function onReconnect(oldEdge: { id: string }, c: Connection): void {
    store.reconnect(oldEdge.id, c.source, c.target, c.sourceHandle ?? undefined, toPortOf(c.targetHandle));
    rebuildEdges(); // revert the anchor's optimistic move if the store rejected it
  }
  function onDeleteEdges(removed: ReadonlyArray<{ id: string }>): void {
    for (const e of removed) store.disconnect(e.id);
    rebuildEdges();
  }
  function onDragStop(detail: { nodes: TriggerFlowNode[] }): void {
    for (const n of detail.nodes) syncPos(n);
  }
  const onConnectEnd: OnConnectEnd = (event, conn) => {
    if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
    const toId = nodeIdAtEvent(event);
    if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, conn.fromHandle.id, toId);
  };
  /** A wire dropped on a node body (not a handle): wire it to that node's input — or
      its output if the drag began at an input. `store.connect` validates direction /
      cycle / dup, so a drop that can't be accepted is simply ignored. When the drag
      began at a source handle, carry its id (a switch band) so the band wire lands.

      Drop-anywhere routes by SOURCE kind (memory `graph-interaction-prefs`): a wire from a
      MODIFIER node lands on the target's `mod` input; every other source lands on the flow
      `in`. So dropping Trail on a play node body wires its modifier chain, not a flow edge. */
  function kindOf(id: string): string | undefined {
    return store.selectedGraph?.nodes.find((n) => n.id === id)?.kind;
  }
  /** The `param:<key>` port a modulation-source drop on `toId` should land on: the target's
      first exposed row, else auto-expose its first numeric param (a sensible default so a drop
      onto a bare node still lands). Undefined when the target has no modulatable params. */
  function paramPortFor(toId: string): ToPort {
    const to = store.selectedGraph?.nodes.find((n) => n.id === toId);
    if (!to) return undefined;
    let key = store.modInputsOf(to)[0]?.param ?? store.availableModParams(to)[0]?.key;
    if (key && !store.modInputsOf(to).some((r) => r.param === key)) store.addModInput(to, key);
    return key ? (`param:${key}` as const) : undefined;
  }
  function dropConnect(
    fromId: string,
    fromType: 'source' | 'target' | null,
    fromPort: string | null | undefined,
    toId: string,
  ): void {
    if (fromId === toId) return;
    if (fromType === 'target') {
      // drag began at an INPUT handle → the dropped-on node becomes the source; route by ITS kind.
      // If the drag left a `param:<key>` row, keep that port (the dropped node must be a source).
      const paramPort = toPortOf(fromPort);
      const toPort = paramPort && voice.paramKeyOf(paramPort) !== null ? paramPort : kindOf(toId) === 'modifier' ? 'mod' : undefined;
      store.connect(toId, fromId, undefined, toPort);
    } else if (kindOf(fromId) && voice.isModSourceKind(kindOf(fromId)!)) {
      // Drop-anywhere from a modulation source routes to a param row (memory `graph-interaction-prefs`).
      const port = paramPortFor(toId);
      if (port) store.connect(fromId, toId, fromPort ?? undefined, port);
    } else {
      store.connect(fromId, toId, fromPort ?? undefined, kindOf(fromId) === 'modifier' ? 'mod' : undefined);
    }
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
    canEdit={store.canEdit}
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
    onNodeDragStop={guard('drag', onDragStop)}
    onConnect={guard('connect', onConnect)}
    onConnectEnd={guard('connect-end', onConnectEnd)}
    onReconnect={guard('reconnect', onReconnect)}
    onDelete={guard('delete', ({ edges: removed }) => onDeleteEdges(removed))}
  >
    {#snippet palette()}
      <div class="palette-stack">
        <GraphPalette items={PALETTE_ITEMS} add={addNodeAt} disabled={!store.canEdit} />
        <ModifierPalette add={addModifierNodeAt} disabled={!store.canEdit} />
        <GraphPalette items={MODULATION_ITEMS} add={addNodeAt} ariaLabel="Add modulation source" disabled={!store.canEdit} />
      </div>
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
  /* the add-node kind palette + the modifier category palette, stacked top-left */
  .palette-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
  /* the "select a graph" placeholder, centred by GraphCanvas's empty slot */
  .thint {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }
</style>
