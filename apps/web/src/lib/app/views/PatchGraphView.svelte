<script lang="ts">
  /* Patch Graph v2 — the physical rig as three holder zones (D1):

       ┌ Controller ┐   ┌───────── Drum Kit ─────────┐   ┌ Drum Triggers ┐
       │  Output …  │   │ ┌ Drum ┐  Hoop → Hoop …     │   │  Trigger …     │
       └────────────┘   │ └──────┘                    │   └───────────────┘
                        └────────────────────────────┘

     The Controller holds the physical Outputs; the Drum Kit nests a drum SUB-zone per drum,
     each holding that drum's Hoop nodes; the Drum Triggers hold the per-drum Trigger nodes.
     Wiring is the physical data run `Output → Hoop → Hoop …` (grey, static); the per-wire rule
     is core's `classifyChainConnection` (shared with the server backstop). A greyed dotted,
     non-interactive Trigger → Drum wire shows the identity binding (no routing).

     LAYOUT IS MANUAL + PERSISTED. Leaf positions are seeded ONCE deterministically then frozen
     into `kit.nodeLayout` (server-authoritative, synced); the graph never auto-flows. The zones
     AUTO-FIT their members (a drag reflows them). The output half is DERIVED from the project's
     `kit.outputs` and a rewire is read back (`routingFromGraph`), recompiled (`patchToOutputs`),
     and pushed via `store.setRouting`; a drag is persisted via `store.setNodeLayout`. */
  import { onDestroy, onMount, setContext, untrack } from 'svelte';
  import type { Connection, EdgeTypes, Node, NodeTypes } from '@xyflow/svelte';
  import { DEFAULT_KIT } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { topoDrumsFromKit, type PatchFlowEdge, type PatchFlowNode } from '../patch-topology';
  import { outputsToPatch, patchToOutputs, type PatchRouting } from '../patch-routing';
  import {
    defaultRouting,
    outputsSignature,
    routingFromGraph,
    routingSignature,
    type OutputScalars,
    type RoutingDrum,
  } from '../patch-graph';
  import {
    buildChainEdges,
    buildLeafNodes,
    buildRefEdges,
    classifyGraphConnection,
    computeZoneNodes,
    type XY,
    type ZoneDrum,
    type ZoneGraphInput,
    type ZoneTrigger,
  } from '../patch-zones';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import PatchNode from './PatchNode.svelte';
  import PatchZoneNode from './PatchZoneNode.svelte';
  import { PATCH_STORE_KEY } from './patch-context';
  import WireEdge from './WireEdge.svelte';
  import RefEdge from './RefEdge.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import type { FlowApi } from './FlowHandle.svelte';
  import Inspector from '../docks/Inspector.svelte';
  import { GraphHover } from './graph-hover.svelte';
  import { guardFlowCallback } from './flow-guard';
  import { nodeIdAtEvent } from './flow-dom';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import { pushToast } from '../../ui/toast.svelte';
  import Cable from '@lucide/svelte/icons/cable';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // Hand the live store down to the xyflow custom nodes (rename overrides on a node face).
  setContext(
    PATCH_STORE_KEY,
    untrack(() => store),
  );

  const nodeTypes: NodeTypes = { patch: PatchNode, zone: PatchZoneNode };
  const edgeTypes: EdgeTypes = { wire: WireEdge, ref: RefEdge };
  const hover = new GraphHover();
  let flowApi = $state<FlowApi | null>(null);

  // ---- static kit-derived shape (drums, triggers) — read once at mount ----------
  /** Physical sensor zones for a drum (union of canonical + authored) — for the trigger sub. */
  function zonesForDrum(drumId: string): string[] {
    const canonical = drumId === 'kick' ? ['center', 'shell'] : ZONE_LABELS;
    const authored = store.pads.filter((p) => p.drumId === drumId).map((p) => p.zoneLabel);
    return [...new Set<string>([...canonical, ...authored])];
  }

  const kit = untrack(() => store.project?.kit ?? DEFAULT_KIT);
  const topoDrums = untrack(() => topoDrumsFromKit(kit, store.drums, zonesForDrum));
  const drums: ZoneDrum[] = topoDrums.map((d) => ({ id: d.id, label: d.label, hoopCount: d.hoopCount }));
  const routingDrums: RoutingDrum[] = drums.map((d) => ({ id: d.id, hoopCount: d.hoopCount }));
  const triggers: ZoneTrigger[] = drums.map((d) => ({
    drumId: d.id,
    label: `${d.label} Trigger`,
    sub: `${zonesForDrum(d.id).length} zones`,
  }));

  const initialOutputs = untrack(() => store.project?.kit.outputs) ?? [];
  const initialRouting: PatchRouting = initialOutputs.length ? outputsToPatch(initialOutputs) : defaultRouting(routingDrums);

  // ---- build the full graph (leaves + auto-fit zones + chain/ref edges) ----------
  const decorate = (edges: PatchFlowEdge[]): PatchFlowEdge[] =>
    hover.decorate(edges.map((e) => (e.type === 'ref' ? e : { ...e, type: 'wire' as const })));

  function buildGraph(routing: PatchRouting, layout: Record<string, XY> | undefined): { nodes: Node[]; edges: PatchFlowEdge[] } {
    const input: ZoneGraphInput = { drums, routing, triggers };
    const leaves: PatchFlowNode[] = buildLeafNodes(input, layout).map((n) => ({ ...n, zIndex: 10 }));
    const leafIds = new Set(leaves.map((n) => n.id));
    const zones = computeZoneNodes(leaves, drums);
    const drumIds = new Set(drums.map((d) => d.id));
    const chain = buildChainEdges(routing, (id) => leafIds.has(id));
    const refs = buildRefEdges(triggers, (id) => drumIds.has(id));
    return { nodes: [...zones, ...leaves], edges: decorate([...chain, ...refs]) };
  }

  const initial = untrack(() => buildGraph(initialRouting, store.project?.kit.nodeLayout));
  let nodes = $state.raw<Node[]>(initial.nodes);
  let edges = $state.raw<PatchFlowEdge[]>(initial.edges);

  /** The leaf (patch) nodes only — zones are derived, never wired/read as routing. */
  function patchLeaves(): PatchFlowNode[] {
    return nodes.filter((n) => n.type === 'patch') as PatchFlowNode[];
  }

  /** The live leaf positions (patch nodes only), keyed by node id. */
  function leafPositions(): Record<string, XY> {
    const map: Record<string, XY> = {};
    for (const n of patchLeaves()) map[n.id] = n.position;
    return map;
  }

  /** Recompute the auto-fit zone rects from the current leaf positions (after a drag reflows). */
  function resyncZones(): void {
    const leaves = patchLeaves();
    nodes = [...computeZoneNodes(leaves, drums), ...leaves];
  }

  // ---- per-output transport scalars the graph doesn't author --------------------
  function scalarsFor(outputId: string): OutputScalars {
    const o = store.project?.kit.outputs.find((x) => x.id === outputId);
    return o
      ? { startUniverse: o.startUniverse, channelsPerPixel: o.channelsPerPixel, rgbOrder: o.rgbOrder }
      : { channelsPerPixel: 3 };
  }

  // ---- rewire read-back + push --------------------------------------------------
  let lastSig = routingSignature(initialRouting);
  function commitRouting(): void {
    const routing = routingFromGraph(patchLeaves(), edges, scalarsFor);
    const sig = routingSignature(routing);
    if (sig === lastSig) return;
    lastSig = sig;
    store.setRouting(patchToOutputs(routing));
    // The output subs ("N hoops") + zone rects can change with the chain; rebuild in place,
    // keeping the current leaf positions.
    rebuild(routing);
  }

  const liveRouting = $derived(routingFromGraph(patchLeaves(), edges, scalarsFor));

  /** Rebuild the whole graph from an authoritative routing, preserving current leaf positions. */
  function rebuild(routing: PatchRouting): void {
    const rebuilt = buildGraph(routing, leafPositions());
    nodes = rebuilt.nodes;
    edges = rebuilt.edges;
  }

  function forceRebuild(): void {
    const outputs = store.project?.kit.outputs ?? [];
    const routing = outputs.length ? outputsToPatch(outputs) : defaultRouting(routingDrums);
    rebuild(routing);
    lastSig = routingSignature(routing);
  }

  /** Group-A flow-guard hardening: a throw in an xyflow callback becomes a reported fault +
      a self-healing rebuild from the authoritative outputs, not a frozen canvas. */
  function guard<A extends unknown[]>(where: string, fn: (...args: A) => void): (...args: A) => void {
    return guardFlowCallback(where, fn, (w, err) => {
      const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
      console.error(`[patch-graph] ${w} failed`, err);
      store.reportError('patch-graph', w, detail);
      forceRebuild();
    });
  }

  // ---- hover: accent the node's connected wires (no node lift) -------------------
  function onEnter(id: string): void {
    hover.enter(id);
    edges = hover.decorate(edges);
  }
  function onLeave(): void {
    hover.leave();
    edges = hover.decorate(edges);
  }

  // ---- wiring (Output→Hoop / Hoop→Hoop only; core rule + toast) ------------------
  /** Reject an illegal wire with core's user-facing message; accept a legal one. */
  function onBeforeConnect(c: Connection): Connection | false {
    if (!c.source || !c.target) return false;
    const verdict = classifyGraphConnection(edges, c.source, c.target);
    if (!verdict.ok) {
      pushToast(verdict.message, { tone: 'error' });
      return false;
    }
    return c;
  }

  let wireSeq = 0;
  /** A wire dropped on a node BODY (not a handle): wire it to that node's input if the drag began
      at a source, honouring the same core rule. */
  function dropConnect(fromId: string, fromType: 'source' | 'target' | null, toId: string): void {
    if (fromId === toId) return;
    const source = fromType === 'target' ? toId : fromId;
    const target = fromType === 'target' ? fromId : toId;
    if (onBeforeConnect({ source, target, sourceHandle: null, targetHandle: null }) === false) return;
    edges = hover.decorate([...edges, { id: `e:${source}->${target}:${++wireSeq}`, source, target, type: 'wire' }]);
    commitRouting();
  }

  /** Re-point an existing wire; validate the prospective set (without the old edge) against the
      core rule. On rejection snap back; otherwise update in place + recompile. */
  function onReconnect(oldEdge: { id: string }, conn: Connection): void {
    if (!conn.source || !conn.target) {
      edges = hover.decorate([...edges]);
      return;
    }
    const others = edges.filter((e) => e.id !== oldEdge.id);
    const verdict = classifyGraphConnection(others, conn.source, conn.target);
    if (!verdict.ok) {
      pushToast(verdict.message, { tone: 'error' });
      edges = hover.decorate([...edges]); // snap back
      return;
    }
    edges = hover.decorate(edges.map((e) => (e.id === oldEdge.id ? { ...e, source: conn.source!, target: conn.target! } : e)));
    commitRouting();
  }

  // ---- layout persistence (seed-freeze + drag write-back) -----------------------
  /** Persist the current leaf positions to the server-authoritative `kit.nodeLayout`. */
  function persistLayout(): void {
    store.setNodeLayout(leafPositions());
  }

  // Seed-freeze: on mount, write the full (seed ⊕ stored) layout back once so a fresh kit's
  // deterministic seed is frozen into `nodeLayout` (idempotent for an already-seeded kit).
  onMount(() => {
    // Re-fit once the zone containers have measured (they gate the graph's true bounds) so the
    // whole rig lands centred, not the pre-measurement subset.
    requestAnimationFrame(() => requestAnimationFrame(() => flowApi?.fitView({ padding: 0.16 })));

    if (!store.project || !store.canEdit) return;
    const stored = store.project.kit.nodeLayout ?? {};
    const live = leafPositions();
    const missing = Object.keys(live).some((id) => stored[id] === undefined);
    if (missing) persistLayout();
  });

  // ---- COLD-LOAD ADOPT: the output half seeds once at mount; the server's real kit.outputs
  // arrive later. Adopt them when their signature diverges from what we last drew (not our echo).
  $effect(() => {
    const outputs = store.project?.kit.outputs;
    if (!outputs || outputs.length === 0) return;
    const incomingSig = outputsSignature(outputs);
    if (incomingSig === lastSig) return;
    untrack(() => {
      if (incomingSig === routingSignature(liveRouting)) {
        lastSig = incomingSig;
        return;
      }
      rebuild(outputsToPatch(outputs));
      lastSig = incomingSig;
    });
  });

  // Publish the live routing to the shell so the Inspector's pixel read-out reflects the wiring.
  $effect(() => {
    shell.setPatchRouting(liveRouting);
  });
  onDestroy(() => shell.setPatchRouting(null));
</script>

<div class="patch-view">
  <div class="phead">
    <PanelHeader icon={Cable} title="Patch Graph" />
  </div>

  <div class="prow">
    <div class="gwrap">
      <GraphCanvas
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        defaultEdgeOptions={{ type: 'wire' }}
        fitPadding={0.16}
        minimap
        onFlow={(f) => (flowApi = f)}
        {onBeforeConnect}
        onNodeClick={(id) => shell.select({ kind: 'patch', nodeId: id })}
        onPaneClick={() => shell.clearSelection()}
        onNodeEnter={onEnter}
        onNodeLeave={onLeave}
        onConnect={guard('connect', () => commitRouting())}
        onReconnect={guard('reconnect', onReconnect)}
        onDelete={guard('delete', () => commitRouting())}
        onNodeDragStop={guard('drag', () => {
          resyncZones();
          persistLayout();
        })}
        onConnectEnd={guard('connect-end', (event, conn) => {
          if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
          const toId = nodeIdAtEvent(event);
          if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, toId);
        })}
      />
    </div>

    <div class="idock">
      <Inspector {store} {shell} />
    </div>
  </div>
</div>

<style>
  .patch-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--shell-gap);
    min-height: 0;
    height: 100%;
  }
  .prow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: var(--shell-gap);
    min-height: 0;
  }
  .gwrap {
    min-width: 0;
    min-height: 0;
  }
  .idock {
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .phead {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .phead :global(.panel-hd) {
    border-bottom: none;
  }
</style>
