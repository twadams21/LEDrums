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
  import { listModifiersByCategory, voice, COLLECTIONS, type PlayType } from '@ledrums/core';
  import Blend from '@lucide/svelte/icons/blend';
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
    triggerEdgeSignature,
    triggerNodeSignature,
    type TriggerProjectionCache,
  } from './trigger-flow-projection';
  import { GraphHover } from './graph-hover.svelte';
  import { findFreePosition, type Rect } from './node-placement';
  import { nodeIdAtEvent } from './flow-dom';
  import { guardFlowCallback } from './flow-guard';
  import { TRIGGER_STORE_KEY } from './trigger-context';
  import TriggerNode from './TriggerNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import type { FlowApi } from './FlowHandle.svelte';
  import NodeEditor, { type NodeEditorTab } from './NodeEditor.svelte';
  import AddPalette, { type AddGroup } from './AddPalette.svelte';
  import { ADD_NODE_DRAG_TYPE, decodeAddDragPayload } from './add-pane';
  import GraphsDock from './GraphsDock.svelte';
  import Inspector from '../docks/Inspector.svelte';
  import Splitter from '../../ui/Splitter.svelte';

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

  // ---- Node Editor drawer (wave-3 shell): Add palette + Inspector -----------
  // The Add tab lists everything the graph can gain in one searchable surface:
  // node kinds, then modulation sources, then the modifier registry grouped by
  // category (registry-driven, so a newly registered modifier appears with no
  // edit here). Selecting a node flips the drawer to its Inspector tab.
  let neTab = $state<NodeEditorTab>('add');
  $effect(() => {
    neTab = shell.selection?.kind === 'node' ? 'inspector' : 'add';
  });
  const EDITOR_W = { key: 'triggerNodeEditorW', min: 280, max: 520, def: 340 };
  const editorW = $derived(store.paneSizes[EDITOR_W.key] ?? EDITOR_W.def);
  const setEditorW = (v: number): void => {
    store.paneSizes = { ...store.paneSizes, [EDITOR_W.key]: v };
  };

  const MOD_HINT: Partial<Record<NodeKind, string>> = {
    envelope: 'per-hit shape',
    lfo: 'continuous wave',
    cc: 'MIDI CC or OSC',
  };
  const MODIFIER_GROUP_PREFIX = 'modifier:';
  const addGroups = $derived<AddGroup[]>([
    {
      key: 'play',
      label: 'Effect',
      items: COLLECTIONS.map((c) => ({
        id: c.type,
        name: c.label,
        icon: kindIcon.play,
        tint: tint.play,
        hint: c.blurb,
      })),
    },
    {
      key: 'route',
      label: 'Route',
      items: NODE_KINDS.filter(
        (kind) => kind !== 'play' && kind !== 'output' && kind !== 'modifier' && !voice.isModSourceKind(kind),
      ).map((kind) => ({
        id: kind,
        name: kindLabel[kind],
        icon: kindIcon[kind],
        tint: tint[kind],
      })),
    },
    {
      key: 'modulation',
      label: 'Modulate',
      items: NODE_KINDS.filter((kind) => voice.isModSourceKind(kind)).map((kind) => ({
        id: kind,
        name: kindLabel[kind],
        icon: kindIcon[kind],
        tint: tint[kind],
        hint: MOD_HINT[kind],
      })),
    },
    {
      key: `${MODIFIER_GROUP_PREFIX}all`,
      label: 'Modify',
      items: listModifiersByCategory().flatMap((g) =>
        g.modifiers.map((m) => ({ id: m.id, name: m.name, icon: Blend, tint: 'var(--role-mod)', hint: g.label })),
      ),
    },
  ]);

  // Placement: new nodes land at a free spot near the visible canvas centre. The
  // flow instance arrives via GraphCanvas's FlowHandle; the wrapper element gives
  // the on-screen rect to centre on.
  let flowApi = $state<FlowApi | null>(null);
  let canvasWrap = $state<HTMLElement | null>(null);
  function canvasCentre(): { x: number; y: number } {
    const r = canvasWrap?.getBoundingClientRect();
    if (!flowApi) return { x: 0, y: 0 };
    return flowApi.screenToFlowPosition(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 });
  }
  function handleAdd(id: string, groupKey: string): void {
    const c = canvasCentre();
    handleAddAt(id, groupKey, c.x, c.y);
  }
  function handleAddAt(id: string, groupKey: string, x: number, y: number): void {
    if (groupKey === 'play') addPlayNodeAt(id as PlayType, x, y);
    else if (groupKey.startsWith(MODIFIER_GROUP_PREFIX)) addModifierNodeAt(id, x, y);
    else addNodeAt(id as NodeKind, x, y);
  }
  /** Add a typed play node (D3) near the palette-supplied flow centre. */
  function addPlayNodeAt(playType: PlayType, cx: number, cy: number): void {
    const p = spawnAt(cx, cy);
    store.addPlayNode(playType, p.x, p.y);
  }
  /** Estimated canvas footprint per existing node — the card plus room for mod rows /
      band fans. An estimate is fine: the probe only needs "roughly where nodes sit". */
  const PLACE_H = 96;
  /** Occupied rects of the open graph's nodes, preferring xyflow's measured live size. */
  function occupiedRects(): Rect[] {
    const measured = new Map(nodes.map((n) => [n.id, n]));
    return (store.selectedGraph?.nodes ?? []).map((n) => {
      const m = measured.get(n.id);
      return {
        x: m?.position.x ?? n.x,
        y: m?.position.y ?? n.y,
        w: m?.measured?.width ?? NODE_W,
        h: m?.measured?.height ?? PLACE_H,
      };
    });
  }
  /** Free spawn position near the palette-supplied flow centre — repeated adds fan out
      instead of stacking on the exact centre (phase-2 item 1.5 + the "corrupted node"
      pointer-theft illusion it caused). */
  function spawnAt(cx: number, cy: number): { x: number; y: number } {
    return findFreePosition(occupiedRects(), cx - NODE_W / 2, cy - 40, NODE_W, PLACE_H);
  }
  /** Add a node through the store (source of truth) near the palette-supplied flow centre. */
  function addNodeAt(kind: NodeKind, cx: number, cy: number): void {
    const p = spawnAt(cx, cy);
    store.addNode(kind, p.x, p.y);
  }
  /** Add a specific modifier node (category palette) near the palette-supplied flow centre. */
  function addModifierNodeAt(modifierId: string, cx: number, cy: number): void {
    const p = spawnAt(cx, cy);
    store.addModifierNode(modifierId, p.x, p.y);
  }
  function onPaletteDragOver(e: DragEvent): void {
    const dt = e.dataTransfer;
    if (!dt || !Array.from(dt.types).includes(ADD_NODE_DRAG_TYPE)) return;
    e.preventDefault();
    dt.dropEffect = 'copy';
  }
  function onPaletteDrop(e: DragEvent): void {
    const payload = decodeAddDragPayload(e.dataTransfer?.getData(ADD_NODE_DRAG_TYPE) ?? '');
    if (!payload || !flowApi) return;
    e.preventDefault();
    const p = flowApi.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    handleAddAt(payload.id, payload.groupKey, p.x, p.y);
  }

  // ---- xyflow projection of the store graph ---------------------------------
  let nodes = $state.raw<TriggerFlowNode[]>([]);
  let edges = $state.raw<TriggerFlowEdge[]>([]);

  /** Authoritative graph signatures — drive reactive rebuilds. Positions are included so
      remote same-graph moves repaint, while selection-only changes still preserve xyflow's
      live measured node object through the projection cache. */
  /** Per-node identity signature: kind plus a value+bands switch's handle-affecting shape
      (mode + band count). Drives reactive rebuilds AND decides which flow-node objects can be
      reused on re-projection — reuse keeps xyflow's measured handleBounds + live position, so a
      structure change to one node never makes every node drop its wires or snap position. */
  const nodeSig = $derived((store.selectedGraph?.nodes ?? []).map(triggerNodeSignature).join('|'));
  const edgeSig = $derived(
    (store.selectedGraph?.edges ?? []).map(triggerEdgeSignature).join('|'),
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
        const missing = projectionDesyncIds(
          projected.nodes.map((n) => n.id),
          g.nodes.map((n) => n.id),
        );
        if (missing.length) {
          const detail = {
            missing,
            cacheGraphKey: projectionCache.graphKey,
            currentGraphKey: graphKey,
            flowNodeIds: projected.nodes.map((n) => n.id),
            graphNodeIds: g.nodes.map((n) => n.id),
          };
          console.error(
            '[trigger-graph] projection desync - rendered flow-node ids missing from the store graph',
            detail,
          );
          store.reportError('trigger-graph', 'projection-desync', JSON.stringify(detail));
          projectionCache = resetProjectionCache();
          const clean = projectTriggerFlowNodes({
            graph: g,
            graphKey,
            selectedNodeId: selId,
            previousNodes: [],
            cache: projectionCache,
          });
          projectionCache = clean.cache;
          return clean.nodes;
        }
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
  <div class="graphrow" style:--editor-w={`${editorW}px`}>
  <div
    class="gwrap"
    bind:this={canvasWrap}
    role="region"
    aria-label="Trigger graph canvas"
    ondragover={onPaletteDragOver}
    ondrop={onPaletteDrop}
  >
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
      onFlow={(f) => (flowApi = f)}
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
      {#snippet empty()}
        <p class="thint">Select a graph from the section to edit it.</p>
      {/snippet}
    </GraphCanvas>
  </div>

  <div class="editor-wrap">
    <Splitter
      orientation="vertical"
      size={editorW}
      min={EDITOR_W.min}
      max={EDITOR_W.max}
      invert
      label="Resize node editor"
      onResize={setEditorW}
      style="left: calc(var(--shell-gap) * -0.5); top: 0; bottom: 0;"
    />
    <NodeEditor bind:tab={neTab}>
      {#snippet add()}
        <AddPalette groups={addGroups} onAdd={handleAdd} disabled={!store.canEdit} />
      {/snippet}
      {#snippet inspector()}
        <Inspector {store} {shell} />
      {/snippet}
    </NodeEditor>
  </div>
  </div>

  <GraphsDock {store} {shell} />
</div>

<style>
  .trigger-view {
    display: grid;
    grid-template-rows: minmax(0, 1fr) 172px;
    gap: var(--shell-gap);
    min-height: 0;
    height: 100%;
  }
  .graphrow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--editor-w);
    gap: var(--shell-gap);
    min-height: 0;
    position: relative;
  }
  .gwrap {
    min-width: 0;
    min-height: 0;
  }
  .editor-wrap {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  /* the "select a graph" placeholder, centred by GraphCanvas's empty slot */
  .thint {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }
</style>
