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
  import { NODE_W, type NodeKind } from '../../trigger-lab/sim';
  import { canConnect, type ToPort, type WireRejection } from '../../trigger-lab/store/graph-wiring';
  import { wireRejectionMessage } from '../../trigger-lab/store/wire-toasts';
  import { pushToast } from '../../ui/toast.svelte';
  import type { WireDragFrom } from './WireDragValidity.svelte';
  import { wireInvalidPreview, spliceArmedPreview } from './wire-preview.svelte';
  import { canvasDropPreview } from './canvas-drop-preview.svelte';
  import { lintPreview } from './lint-preview.svelte';
  import { lintEntries, lintEntriesByNode } from './graph-lint';
  import { GraphLintIndex, GRAPH_LINT_KEY } from './graph-lint-index.svelte';
  import GraphLintStrip from './GraphLintStrip.svelte';
  import { edgeUnderNode, type NodeRect } from './splice-geometry';
  import { voice, type PlayType } from '@ledrums/core';
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
  import AlignGuides from './AlignGuides.svelte';
  import { computeAlignment, type AlignRect, type GuideLine } from './align-guides';
  import type { FlowApi } from './FlowHandle.svelte';
  import NodeEditor, { type NodeEditorTab } from './NodeEditor.svelte';
  import AddPalette, { type AddGroup } from './AddPalette.svelte';
  import { ADD_NODE_DRAG_TYPE, decodeAddDragPayload } from './add-pane';
  import { buildAddGroups, EFFECT_GROUP_KEY, MODIFIER_GROUP_PREFIX } from './add-node-taxonomy';
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

  // Per-node lint badges (R06): the offending node wears a badge for the same finding the
  // strip shows. Handed to the custom nodes via context (like `hover`); kept in sync from the
  // one compiled issue list below so strip and badges can never drift.
  const lintIndex = new GraphLintIndex();
  setContext(GRAPH_LINT_KEY, lintIndex);

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

  const addGroups = $derived<AddGroup[]>(buildAddGroups());

  // Placement: new nodes land at a free spot near the visible canvas centre. The
  // flow instance arrives via GraphCanvas's FlowHandle; the wrapper element gives
  // the on-screen rect to centre on.
  let flowApi = $state<FlowApi | null>(null);
  let canvasWrap = $state<HTMLElement | null>(null);
  // R12: the canvas wears a "drop target is live" ring while a new node is dragged in from the
  // Add pane. Live during the drag; the shot seam pins it (DEV-only) for a ui-shot capture since
  // headless Chrome can't drive the HTML5 drag.
  let dragActive = $state(false);
  const dropActive = $derived(dragActive || (import.meta.env.DEV && canvasDropPreview.current));
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
    if (groupKey === EFFECT_GROUP_KEY) addPlayNodeAt(id as PlayType, x, y);
    else if (groupKey.startsWith(MODIFIER_GROUP_PREFIX)) addModifierNodeAt(id, x, y);
    else if (id.startsWith('envelope:')) addEnvelopeNodeAt(id.slice('envelope:'.length), x, y);
    else if (id.startsWith('lfo:')) addLfoNodeAt(id.slice('lfo:'.length), x, y);
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
  function addEnvelopeNodeAt(preset: string, cx: number, cy: number): void {
    const p = spawnAt(cx, cy);
    store.addNode('envelope', p.x, p.y, { envelopePreset: preset });
  }
  function addLfoNodeAt(waveform: string, cx: number, cy: number): void {
    const p = spawnAt(cx, cy);
    store.addNode('lfo', p.x, p.y, { lfoWaveform: waveform });
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
    dragActive = true;
  }
  function onPaletteDragLeave(e: DragEvent): void {
    // dragleave fires when crossing into child elements too; only clear when the pointer has
    // actually left the canvas wrapper (relatedTarget null = left the window entirely).
    const to = e.relatedTarget as Node | null;
    if (!to || !canvasWrap?.contains(to)) dragActive = false;
  }
  function onPaletteDrop(e: DragEvent): void {
    dragActive = false;
    const payload = decodeAddDragPayload(e.dataTransfer?.getData(ADD_NODE_DRAG_TYPE) ?? '');
    if (!payload || !flowApi) return;
    e.preventDefault();
    const p = flowApi.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    handleAddAt(payload.id, payload.groupKey, p.x, p.y);
  }

  // ---- xyflow projection of the store graph ---------------------------------
  let nodes = $state.raw<TriggerFlowNode[]>([]);
  // Alignment guide lines drawn while a single node is dragged (snap-to-neighbour-edges). Cleared
  // on drop. Lives here (not the store) — it's pure drag-time canvas decoration.
  let alignGuides = $state<GuideLine[]>([]);
  let edges = $state.raw<TriggerFlowEdge[]>([]);

  /** Authoritative graph signatures — drive reactive rebuilds. Positions are included so
      remote same-graph moves repaint, while selection-only changes still preserve xyflow's
      live measured node object through the projection cache. */
  /** Per-node identity signature: kind plus a value+bands switch's handle-affecting shape
      (mode + band count). Drives reactive rebuilds AND decides which flow-node objects can be
      reused on re-projection — reuse keeps xyflow's measured handleBounds + live position, so a
      structure change to one node never makes every node drop its wires or snap position. */
  const nodeSig = $derived(
    (store.selectedGraph?.nodes ?? []).map((n) => triggerNodeSignature(n, store.selectedGraph)).join('|'),
  );
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
  // R08 wire-splice: the edge a dragged node is currently armed to splice into (null = none).
  // Set by the drag hit-test below; the edges effect re-decorates so the armed wire lights up
  // BEFORE release (pre-release indication). Release then splices via the store.
  let armedSpliceEdgeId = $state<string | null>(null);

  /** The edge to render armed: the live drag arming, or — DEV/ui-shot only — the first flow wire
      when the shot seam pins `spliceArmedPreview` (the live arming is drag-only, unreachable by a
      headless capture). Null (and tree-shaken) outside DEV. */
  function spliceArmedEdgeForRender(built: TriggerFlowEdge[]): string | null {
    if (armedSpliceEdgeId) return armedSpliceEdgeId;
    if (import.meta.env.DEV && spliceArmedPreview.current) {
      return built.find((e) => !e.data?.mod && !e.data?.modulation)?.id ?? null;
    }
    return null;
  }

  function rebuildEdges(): void {
    const g = store.selectedGraph;
    const built = hover.decorate(g ? untrack(() => graphToFlowEdges(g)) : []);
    const armed = spliceArmedEdgeForRender(built);
    edges = armed
      ? built.map((e) =>
          e.id === armed ? { ...e, class: e.class ? `${e.class} edge-splice-armed` : 'edge-splice-armed' } : e,
        )
      : built;
  }

  // node array: rebuild on graph switch, structure change, or selection change
  $effect(() => {
    store.selectedPadKey;
    nodeSig;
    selectedNodeId;
    rebuildNodes();
  });
  // edge array: rebuild on graph switch, edge change, hover (highlight), or splice-arming
  $effect(() => {
    store.selectedPadKey;
    edgeSig;
    hover.hoveredId;
    armedSpliceEdgeId;
    spliceArmedPreview.current;
    rebuildEdges();
  });

  // Hide the canvas content while a graph switch re-fits, so the new graph never
  // flashes at the previous graph's viewport — revealed instantly once fitted.
  let fitted = $state(false);
  $effect(() => {
    store.selectedPadKey; // a switch hides the canvas until GraphFitView reports back
    fitted = false;
  });

  // ---- ui-shot: static invalid-wire stand-in (R03 / dev-only) ---------------
  // The red/dotted/dull wire-in-progress is drag-only, so a screenshot can't reach it live.
  // When the shot seam pins `wireInvalidPreview`, span a static line (canvas-local px) between
  // the first node's output and the last node's input so the capture shows a real target. Null
  // (and tree-shaken) outside DEV; depends on `fitted` so it recomputes with the post-fit viewport.
  const wirePreview = $derived.by(() => {
    if (!import.meta.env.DEV || !wireInvalidPreview.current) return null;
    fitted; // recompute once the graph has fit (screen coords depend on the viewport)
    const rect = canvasWrap?.getBoundingClientRect();
    if (!flowApi || !rect || nodes.length < 2) return null;
    const a = nodes[0]!;
    // Land the stand-in on the node most vertically offset from the source, so it reads as a
    // wire arriving AT a target (a diagonal curve) rather than a flat line skewering the row.
    const b = nodes.slice(1).reduce((best, n) =>
      Math.abs(n.position.y - a.position.y) > Math.abs(best.position.y - a.position.y) ? n : best,
    );
    const aw = a.measured?.width ?? NODE_W;
    const ah = a.measured?.height ?? 40;
    const bh = b.measured?.height ?? 40;
    const src = flowApi.flowToScreenPosition({ x: a.position.x + aw, y: a.position.y + ah / 2 });
    const tgt = flowApi.flowToScreenPosition({ x: b.position.x, y: b.position.y + bh / 2 });
    return { x1: src.x - rect.left, y1: src.y - rect.top, x2: tgt.x - rect.left, y2: tgt.y - rect.top };
  });

  // ---- lint strip (R05): render-plan compile issues on the graph surface -----
  // The render plan is computed but consumed nowhere in the web app; surface its `issues` as a
  // persistent strip that says what is wrong and what to do next. DEV/ui-shot only: `lintPreview`
  // pins real compiler issues (from a degenerate graph) because a well-formed authored graph is
  // guaranteed anchors and refuses cycles, so the live strip is otherwise empty. Absent when there
  // are no issues; the component itself renders nothing for an empty list.
  const lintIssues = $derived.by(() => {
    if (import.meta.env.DEV && lintPreview.current) return lintPreview.current;
    const g = store.selectedGraph;
    return g ? voice.compileRenderPlan(g).issues : [];
  });
  // The strip and the node badges read ONE derived entry list; the badges index it by node.
  const lintDisplay = $derived(lintEntries(lintIssues));
  $effect(() => lintIndex.set(lintEntriesByNode(lintDisplay)));

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
  /** Surface a refused wire as one plain-language error toast naming the reason (R03 / doc 1.1).
      A `null` reason (accepted, or a viewer/no-graph no-op) says nothing. */
  function toastRejection(reason: WireRejection | null): void {
    if (reason) pushToast(wireRejectionMessage(reason), { tone: 'error' });
  }
  function onConnect(c: Connection): void {
    // store validates (dup / cycle / direction / port scoping) and returns the reason if refused
    toastRejection(store.connect(c.source, c.target, c.sourceHandle ?? undefined, toPortOf(c.targetHandle)));
    rebuildEdges(); // drop any edge xyflow added optimistically that the store rejected
  }
  function onReconnect(oldEdge: { id: string }, c: Connection): void {
    toastRejection(
      store.reconnect(oldEdge.id, c.source, c.target, c.sourceHandle ?? undefined, toPortOf(c.targetHandle)),
    );
    rebuildEdges(); // revert the anchor's optimistic move if the store rejected it
  }
  function onDeleteEdges(removed: ReadonlyArray<{ id: string }>): void {
    for (const e of removed) store.disconnect(e.id);
    rebuildEdges();
  }
  function onDragStop(detail: { nodes: TriggerFlowNode[] }): void {
    alignGuides = [];
    // Commit the drag position FIRST — this is its own undo checkpoint (moveNode). For a single-node
    // drag, commit the alignment-SNAPPED position (so the node lands exactly on the guide it locked
    // to), recomputed from the final drop location.
    const single = detail.nodes.length === 1;
    for (const n of detail.nodes) {
      const pos = single ? snapAligned(n) : n.position;
      syncPos({ id: n.id, position: pos });
    }
    // Then, if a splice was armed, wire it as a SEPARATE checkpoint recorded AFTER the position
    // commit (R08): one Ctrl/Z pops the splice wiring while the node stays where it was dropped.
    const armed = armedSpliceEdgeId;
    armedSpliceEdgeId = null;
    if (armed && detail.nodes.length === 1 && store.spliceOnDrop(armed, detail.nodes[0]!.id)) {
      rebuildEdges();
    }
  }
  /** AlignRect for a flow node (measured size, else the placement fallback). */
  function alignRectOf(n: TriggerFlowNode): AlignRect {
    return { id: n.id, x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? PLACE_H };
  }
  /** The dragged node's position snapped to its neighbours' edges/centres (align-guides). */
  function snapAligned(n: TriggerFlowNode): { x: number; y: number } {
    const others = nodes.filter((o) => o.id !== n.id).map(alignRectOf);
    const { x, y } = computeAlignment(alignRectOf(n), others);
    return { x, y };
  }
  function onDrag(detail: { targetNode: TriggerFlowNode | null; nodes: TriggerFlowNode[] }): void {
    const moving = detail.targetNode ? [detail.targetNode] : detail.nodes;
    // Single-node drag: snap to neighbours' edges live (guides show WHERE it locks); multi-drag
    // just moves. The snapped position drives the live node, the splice hit-test, and the guides.
    if (moving.length === 1) {
      const dragged = moving[0]!;
      const others = nodes.filter((o) => o.id !== dragged.id).map(alignRectOf);
      const res = computeAlignment(alignRectOf(dragged), others);
      alignGuides = res.guides;
      const snapped = { ...dragged, position: { x: res.x, y: res.y } } as TriggerFlowNode;
      if (res.x !== dragged.position.x || res.y !== dragged.position.y) {
        nodes = nodes.map((n) => (n.id === dragged.id ? snapped : n));
      }
      store.setLiveNodePosition(dragged.id, res.x, res.y);
      updateSpliceArming([snapped]);
      return;
    }
    alignGuides = [];
    for (const n of moving) store.setLiveNodePosition(n.id, n.position.x, n.position.y);
    updateSpliceArming(moving);
  }
  /** Arm the wire the dragged node is sitting on (single-node drags only): a spatial hit-test
      (splice-geometry) picks the overlapped wire, then the store's `canSplice` confirms the
      splice would be legal — so the pre-release indication only lights when release will act. */
  function nodeRect(n: TriggerFlowNode): NodeRect {
    return { x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? PLACE_H };
  }
  function updateSpliceArming(moving: TriggerFlowNode[]): void {
    if (moving.length !== 1) {
      armedSpliceEdgeId = null;
      return;
    }
    const dragged = moving[0]!;
    const rects = new Map<string, NodeRect>(nodes.map((n) => [n.id, nodeRect(n)]));
    rects.set(dragged.id, nodeRect(dragged)); // the dragged node's LIVE position wins
    const ends = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    const hit = edgeUnderNode(dragged.id, rects.get(dragged.id)!, ends, rects);
    armedSpliceEdgeId = hit && store.canSplice(hit, dragged.id) ? hit : null;
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
  /** The `param:<key>` port a modulation-source drop on `toId` WOULD land on — the read-only
      mirror of {@link paramPortFor} used by the in-drag validity check (no auto-expose side
      effect, so hovering a target never mutates the graph). */
  function predictParamPort(toId: string): ToPort {
    const to = store.selectedGraph?.nodes.find((n) => n.id === toId);
    if (!to) return undefined;
    const key = store.modInputsOf(to)[0]?.param ?? store.availableModParams(to)[0]?.key;
    return key ? (`param:${key}` as const) : undefined;
  }
  /** Would dropping the in-progress wire on `toId` (optionally the precise handle under the
      pointer) be ACCEPTED? Read-only mirror of {@link dropConnect}'s routing so the in-drag
      red/dotted/dull styling agrees with what release will actually do — every branch resolves
      to the store's {@link canConnect} verdict, and nothing here mutates the graph. */
  function validateDrop(from: WireDragFrom, toId: string, toHandle: string | null): boolean {
    const g = store.selectedGraph;
    if (!g) return false;
    // Pointer inside a precise handle's radius → validate that exact port (mod / param / flow).
    if (toHandle != null) {
      if (from.type === 'target') return canConnect(g, toId, from.nodeId, undefined, toPortOf(from.handleId));
      return canConnect(g, from.nodeId, toId, from.handleId ?? undefined, toPortOf(toHandle));
    }
    // Drop-anywhere on the node body → mirror dropConnect's source-kind routing.
    if (from.type === 'target') {
      const paramPort = toPortOf(from.handleId);
      const toPort =
        paramPort && voice.paramKeyOf(paramPort) !== null ? paramPort : kindOf(toId) === 'modifier' ? 'mod' : undefined;
      return canConnect(g, toId, from.nodeId, undefined, toPort);
    }
    if (kindOf(from.nodeId) && voice.isModSourceKind(kindOf(from.nodeId)!)) {
      const port = predictParamPort(toId);
      return port ? canConnect(g, from.nodeId, toId, from.handleId ?? undefined, port) : false;
    }
    return canConnect(g, from.nodeId, toId, from.handleId ?? undefined, kindOf(from.nodeId) === 'modifier' ? 'mod' : undefined);
  }
  function dropConnect(
    fromId: string,
    fromType: 'source' | 'target' | null,
    fromPort: string | null | undefined,
    toId: string,
  ): void {
    if (fromId === toId) return;
    let reason: WireRejection | null = null;
    if (fromType === 'target') {
      // drag began at an INPUT handle → the dropped-on node becomes the source; route by ITS kind.
      // If the drag left a `param:<key>` row, keep that port (the dropped node must be a source).
      const paramPort = toPortOf(fromPort);
      const toPort = paramPort && voice.paramKeyOf(paramPort) !== null ? paramPort : kindOf(toId) === 'modifier' ? 'mod' : undefined;
      reason = store.connect(toId, fromId, undefined, toPort);
    } else if (kindOf(fromId) && voice.isModSourceKind(kindOf(fromId)!)) {
      // Drop-anywhere from a modulation source routes to a param row (memory `graph-interaction-prefs`).
      const port = paramPortFor(toId);
      if (port) reason = store.connect(fromId, toId, fromPort ?? undefined, port);
    } else {
      reason = store.connect(fromId, toId, fromPort ?? undefined, kindOf(fromId) === 'modifier' ? 'mod' : undefined);
    }
    toastRejection(reason);
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
    ondragleave={onPaletteDragLeave}
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
      onNodeDrag={guard('drag-live', onDrag)}
      onNodeDragStop={guard('drag', onDragStop)}
      onConnect={guard('connect', onConnect)}
      onConnectEnd={guard('connect-end', onConnectEnd)}
      onReconnect={guard('reconnect', onReconnect)}
      onDelete={guard('delete', ({ edges: removed }) => onDeleteEdges(removed))}
      validateDrag={validateDrop}
      {wirePreview}
    >
      {#snippet overlay()}
        <AlignGuides guides={alignGuides} />
      {/snippet}
      {#snippet empty()}
        <p class="thint">Select a graph from the section to edit it.</p>
      {/snippet}
    </GraphCanvas>
    <!-- Lint strip: persistent, pinned top-left over the canvas so it reads as belonging to the
         surface without reflowing the flow area. Fades in/out with the issue list. -->
    <div class="lint-overlay">
      <GraphLintStrip issues={lintIssues} />
    </div>
    <!-- R12 drop-target ring: an accent ring + faint wash while a new node is dragged in from the
         Add pane, matching the Sections reorder target language (R11 `.section-target`). Non-
         interactive so it never eats the drop; only mounted while the drag is live. -->
    {#if dropActive}
      <div class="drop-ring" aria-hidden="true"></div>
    {/if}
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
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  /* Drop-target ring for add-node drags from the Add pane — the canvas analogue of the Sections
     reorder target (R11 `.col.section-target`): a bright accent ring + faint wash so "drop is
     live" reads at a glance. Overlaid and non-interactive so it never intercepts the drop. */
  .drop-ring {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    border-radius: var(--radius-2);
    background: color-mix(in oklch, var(--accent) 6%, transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklch, var(--accent) 55%, transparent),
      inset 0 0 0 4px color-mix(in oklch, var(--accent) 14%, transparent);
  }
  /* Lint strip overlay — pinned to the canvas's top-left, above the flow surface but out of
     its interaction layer except where the strip itself sits. */
  .lint-overlay {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    right: var(--space-3);
    z-index: 5;
    display: flex;
    pointer-events: none;
  }
  .lint-overlay > :global(*) {
    pointer-events: auto;
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
