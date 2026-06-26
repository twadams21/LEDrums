<script lang="ts">
  /* Patch Graph view — the REAL device-routing topology the rig is wired as, laid
     out left→right across eight stages:

       Sensory Percussion → Trigger → Zone → Drum → Hoop → Data Line → Output → Controller

     input→trigger→zone→drum is the INPUT mapping; drum→hoop→dataline→output→
     controller is the physical OUTPUT wiring. The graph is data-driven: drums +
     per-drum zones come from the store, hoop counts from the canonical kit. All the
     wiring lives in the pure `patch-topology` module; this view is just the
     @xyflow/svelte surface + project-token styling. Selecting a node loads it into
     the right-dock Inspector.

     EDITABLE WIRING (ephemeral): wires can be drawn, deleted and reconnected, and the
     palette can drop local Data Line / Output nodes — but Patch has NO store-backed
     device model yet, so all of this lives in this view's $state and is NOT persisted.
     The real device-settings model (universes, ports, IP) is a separate later slice.

     DATA-LINE / OUTPUT FLAG: the true hoop→dataline→output mapping (universes,
     ports, cross-wiring) lives in the server's DMX map, which is not on the client
     yet. For v1 the hoop chain is chunked into data lines by a fixed capacity (a
     sensible default that demonstrates the real cross-wiring); wiring it to the
     server `dmxMap` over the WS `state` message is the follow-up. We do NOT fake
     precise universe/channel numbers. */
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
  import { DEFAULT_KIT, drumHoopCount } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import {
    buildPatchTopology,
    NODE_H,
    NODE_W,
    type PatchFlowEdge,
    type PatchFlowNode,
    type PatchStage,
    type TopologyDrum,
  } from '../patch-topology';
  import PatchNode from './PatchNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import PatchFitView from './PatchFitView.svelte';
  import PatchPalette from './PatchPalette.svelte';
  import { GraphHover } from './graph-hover.svelte';
  import { nodeIdAtEvent } from './flow-dom';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Cable from '@lucide/svelte/icons/cable';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const nodeTypes: NodeTypes = { patch: PatchNode };
  // wire = the reconnectable custom edge (its ends are drag anchors)
  const edgeTypes: EdgeTypes = { wire: WireEdge };

  // Signal-flow role colour for the two device kinds the palette can add (kept in
  // step with patch-topology's STAGE_ROLE — only these two are user-addable).
  const DEVICE_ROLE: Record<'dataline' | 'output', string> = {
    dataline: 'var(--role-effect)',
    output: 'var(--role-output)',
  };
  let deviceSeq = 0;
  /** Drop a LOCAL, EPHEMERAL device node (Data Line / Output) at a flow-space centre.
      Wiring-only Phase 4: these live in view state, are NOT persisted, and carry no
      device settings — the real device model is a later slice. */
  function addDevice(stage: 'dataline' | 'output', cx: number, cy: number): void {
    const n = ++deviceSeq;
    const label = stage === 'dataline' ? `Data Line ${n}` : `Output ${n}`;
    const node: PatchFlowNode = {
      id: `${stage}:new-${n}`,
      type: 'patch',
      position: { x: cx - NODE_W / 2, y: cy - NODE_H / 2 },
      initialWidth: NODE_W,
      initialHeight: NODE_H,
      data: { label, sub: 'local · not saved', stage: stage as PatchStage, role: DEVICE_ROLE[stage] },
    };
    nodes = [...nodes, node];
  }

  /** Reject self-loops and exact duplicate wires; otherwise accept (xyflow applies
      the default `wire` type so the new edge is reconnectable). */
  function onBeforeConnect(c: Connection): Connection | false {
    if (!c.source || !c.target || c.source === c.target) return false;
    if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
    return c;
  }

  /* Hover accents the node (border, via CSS) + every wire one level connected to it.
     Selection rings the node but does NOT light its wires. Shared with the Trigger
     graph (no node lift — it fought wiring). */
  const hover = new GraphHover();
  function onEnter(id: string): void {
    hover.enter(id);
    edges = hover.decorate(edges);
  }
  function onLeave(): void {
    hover.leave();
    edges = hover.decorate(edges);
  }

  let wireSeq = 0;
  const stageOf = (id: string): PatchStage | undefined => nodes.find((n) => n.id === id)?.data.stage;
  /** A wire dropped on a node body (not a handle): wire it to that node — to its input
      if the drag began at an output, or vice versa. Mirrors PatchNode's handle rules by
      stage (the input source has no target handle; the controller sink has no source)
      and runs the same dup/self guard, then adds the ephemeral local edge. */
  function dropConnect(fromId: string, fromType: 'source' | 'target' | null, toId: string): void {
    if (fromId === toId) return;
    const source = fromType === 'target' ? toId : fromId;
    const target = fromType === 'target' ? fromId : toId;
    if (stageOf(source) === 'controller' || stageOf(target) === 'input') return;
    if (onBeforeConnect({ source, target, sourceHandle: null, targetHandle: null }) === false) return;
    edges = hover.decorate([...edges, { id: `e:${source}->${target}:${++wireSeq}`, source, target, type: 'wire' }]);
  }

  /** Physical sensor zones for a drum. The kick exposes only centre + shell; every
      other drum exposes the full Sensory Percussion zone set. We union that with
      any zones the drum already has authored pads for, so an unexpected authored
      zone still shows. (The physical zone set isn't in the kit data model yet —
      deriving it from a real per-drum sensor config is a follow-up.) */
  function zonesForDrum(drumId: string): string[] {
    const canonical = drumId === 'kick' ? ['center', 'shell'] : ZONE_LABELS;
    const authored = store.pads.filter((p) => p.drumId === drumId).map((p) => p.zoneLabel);
    const wanted = new Set<string>([...canonical, ...authored]);
    // canonical order first, then any extras in their authored order
    const ordered = ZONE_LABELS.filter((z) => wanted.has(z));
    const extras = [...wanted].filter((z) => !ZONE_LABELS.includes(z));
    return [...ordered, ...extras];
  }

  /** Hoop count for a drum, from the canonical kit (per-drum override or global). */
  function hoopCountFor(drumId: string): number {
    const kitDrum = DEFAULT_KIT.drums.find((d) => d.id === drumId);
    return kitDrum ? drumHoopCount(DEFAULT_KIT, kitDrum) : DEFAULT_KIT.global.hoopCount;
  }

  function buildTopoDrums(): TopologyDrum[] {
    return store.drums.map((d) => ({
      id: d.id,
      label: d.label,
      zones: zonesForDrum(d.id),
      hoopCount: hoopCountFor(d.id),
    }));
  }

  // Built ONCE, synchronously at mount, so the nodes exist for SvelteFlow's initial
  // `fitView` (populating them later via an $effect fits an empty graph and leaves
  // the viewport unfitted). The kit is static for a Patch-view session and the view
  // remounts on re-entry, re-deriving from the store — so this stays data-driven
  // without a reactive rebuild. SvelteFlow then owns the arrays (drag mutates node
  // positions), hence $state.raw + two-way bind.
  const initial = buildPatchTopology(buildTopoDrums());
  let nodes = $state.raw<PatchFlowNode[]>(initial.nodes);
  // wire type so every edge end is a reconnect anchor; edits are ephemeral view state
  // (Patch has no store-backed graph — connect/delete/reconnect mutate this array).
  let edges = $state.raw<PatchFlowEdge[]>(initial.edges.map((e) => ({ ...e, type: 'wire' })));
</script>

<div class="patch-view">
  <header class="phead">
    <Eyebrow icon={Cable}>Patch Graph · device routing</Eyebrow>
    <span class="hint">input → trigger → zone → drum → hoop → data line → output → controller</span>
  </header>

  <div class="canvas">
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      {edgeTypes}
      defaultEdgeOptions={{ type: 'wire' }}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesConnectable
      minZoom={0.2}
      deleteKey={['Delete', 'Backspace']}
      onbeforeconnect={onBeforeConnect}
      onnodeclick={({ node }) => shell.select({ kind: 'patch', nodeId: node.id })}
      onpaneclick={() => shell.clearSelection()}
      onnodepointerenter={({ node }) => onEnter(node.id)}
      onnodepointerleave={onLeave}
      onconnectend={(event, conn) => {
        if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
        const toId = nodeIdAtEvent(event);
        if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, toId);
      }}
    >
      <PatchFitView padding={0.15} />
      <Panel position="top-left"><PatchPalette add={addDevice} /></Panel>
      <Background variant={BackgroundVariant.Dots} />
      <Controls />
      <MiniMap />
    </SvelteFlow>
  </div>
</div>

<style>
  .patch-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .phead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .hint {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .canvas {
    min-height: 0;
    min-width: 0;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  /* --- @xyflow/svelte on the project tokens --------------------------------- */
  .canvas :global(.svelte-flow) {
    background: var(--bg-perform);
  }
  /* custom `patch` nodes bring their own card — strip xyflow's default chrome */
  .canvas :global(.svelte-flow__node-patch) {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    width: auto;
    box-shadow: none;
    color: inherit;
    font-family: inherit;
  }
  /* the canvas selection ring is drawn by the node card itself (NodeCard .card.sel) */
  .canvas :global(.svelte-flow__node-patch.selected) {
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
