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
    SvelteFlow,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { DEFAULT_KIT, drumHoopCount } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import {
    buildPatchTopology,
    type PatchFlowEdge,
    type PatchFlowNode,
    type TopologyDrum,
  } from '../patch-topology';
  import PatchNode from './PatchNode.svelte';
  import PatchFitView from './PatchFitView.svelte';
  import { GraphHover } from './graph-hover.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Cable from '@lucide/svelte/icons/cable';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const nodeTypes: NodeTypes = { patch: PatchNode };

  /* Hover → lift the node (nudge its xyflow position so handles + edges follow) and
     accent every wire one level connected to it. Selection rings the node but does
     NOT light its wires. Shared with the Trigger graph. */
  const hover = new GraphHover();
  function onEnter(id: string): void {
    nodes = hover.enter(id, nodes);
    edges = hover.decorate(edges);
  }
  function onLeave(): void {
    nodes = hover.leave(nodes);
    edges = hover.decorate(edges);
  }
  function onDragStart(): void {
    nodes = hover.dragStart(nodes);
    edges = hover.decorate(edges);
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
  let edges = $state.raw<PatchFlowEdge[]>(initial.edges);
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
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesConnectable={false}
      minZoom={0.2}
      onnodeclick={({ node }) => shell.select({ kind: 'patch', nodeId: node.id })}
      onpaneclick={() => shell.clearSelection()}
      onnodepointerenter={({ node }) => onEnter(node.id)}
      onnodepointerleave={onLeave}
      onnodedragstart={onDragStart}
      onnodedragstop={() => hover.dragStop()}
    >
      <PatchFitView padding={0.15} />
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
  .canvas :global(.svelte-flow__handle) {
    width: 7px;
    height: 7px;
    background: var(--surface-2);
    border: 1.5px solid var(--border-strong);
  }
  /* read-only graph: handles are wiring affordances we don't expose for editing */
  .canvas :global(.svelte-flow__handle) {
    pointer-events: none;
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
