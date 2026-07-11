<script lang="ts">
  /* Patch Graph view — the REAL device-routing topology the rig is wired as, laid
     out left→right across eight stages:

       Sensory Percussion → Trigger → Zone → Drum → Hoop → Data Line → Output → Controller

     input→trigger→zone→drum is the INPUT mapping; drum→hoop→dataline→output→
     controller is the physical OUTPUT wiring. The input half is data-driven from the
     store (drums + per-drum zones) with hoop counts from the canonical kit, via the
     pure `patch-topology` module. Selecting a node loads it into the right-dock
     Inspector.

     AUTHORITATIVE OUTPUT HALF (S3): the hoop→dataline→output→controller wiring is no
     longer ephemeral — it is DERIVED from the server Project's `kit.outputs` (the real
     PixLite patch order) via `outputsToPatch` (S2) + `buildOutputHalf`. A rewire
     (connect / disconnect / reconnect / reorder-by-drag) is read back with
     `routingFromGraph`, recompiled with `patchToOutputs`, and pushed via
     `store.setRouting` → the server reroutes the live voice host and round-trips the
     change in the next `state`. When the project declares no outputs yet, a
     `defaultRouting` chunk seeds the graph so there is something to wire. */
  import { onDestroy, setContext, untrack } from 'svelte';
  import type { Connection, EdgeTypes, NodeTypes } from '@xyflow/svelte';
  import { DEFAULT_KIT, type OutputConfig } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import {
    buildPatchTopology,
    topoDrumsFromKit,
    CONTROLLER_ID,
    NODE_H,
    NODE_W,
    STAGE_ORDER,
    type PatchFlowEdge,
    type PatchFlowNode,
    type PatchStage,
  } from '../patch-topology';
  import { hasHoopFanOut, outputsToPatch, patchToOutputs } from '../patch-routing';
  import {
    buildOutputHalf,
    defaultRouting,
    outputsSignature,
    rebuildOutputHalf,
    routingFromGraph,
    routingSignature,
    type OutputScalars,
  } from '../patch-graph';
  import type { PatchRouting } from '../patch-routing';
  import PatchNode from './PatchNode.svelte';
  import PatchClipboardToolbar from './PatchClipboardToolbar.svelte';
import PatchMirrorControl from './PatchMirrorControl.svelte';
  import { PATCH_STORE_KEY } from './patch-context';
  import WireEdge from './WireEdge.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import type { FlowApi } from './FlowHandle.svelte';
  import NodeEditor, { type NodeEditorTab } from './NodeEditor.svelte';
  import AddPalette, { type AddGroup } from './AddPalette.svelte';
  import Inspector from '../docks/Inspector.svelte';
  import { GraphHover } from './graph-hover.svelte';
  import { findFreePosition } from './node-placement';
  import { guardFlowCallback } from './flow-guard';
  import { nodeIdAtEvent } from './flow-dom';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import { pushToast } from '../../ui/toast.svelte';
  import Cable from '@lucide/svelte/icons/cable';
  import Plug from '@lucide/svelte/icons/plug';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // Hand the live store down to the xyflow custom nodes so a PatchNode can prefer the
  // rename override (store.patchLabels[id]) on its face. The store is a stable instance
  // for the view's life — capture once through untrack (mirrors the Trigger graph).
  setContext(
    PATCH_STORE_KEY,
    untrack(() => store),
  );

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
  /** Drop a new device node (Data Line / Output) at a flow-space centre. It carries no
      hoops until wired, so it contributes nothing to the routing on its own; the first
      wire into/out of it is what materializes it (a new Output id) via commitRouting. */
  function addDevice(stage: 'dataline' | 'output', cx: number, cy: number): void {
    const n = ++deviceSeq;
    const label = stage === 'dataline' ? `Data Line ${n}` : `Output ${n}`;
    // spawn on a free spot near the viewport centre — repeated adds fan out (item 1.5)
    const rects = nodes.map((nd) => ({
      x: nd.position.x,
      y: nd.position.y,
      w: nd.measured?.width ?? NODE_W,
      h: nd.measured?.height ?? NODE_H,
    }));
    const pos = findFreePosition(rects, cx - NODE_W / 2, cy - NODE_H / 2, NODE_W, NODE_H);
    const node: PatchFlowNode = {
      id: `${stage}:new-${n}`,
      type: 'patch',
      position: pos,
      initialWidth: NODE_W,
      initialHeight: NODE_H,
      data: { label, sub: 'Connect this device', stage: stage as PatchStage, role: DEVICE_ROLE[stage] },
    };
    nodes = [...nodes, node];
  }

  // ---- Node Editor drawer (wave-3 shell): device palette + Inspector --------
  // The two user-addable device kinds; a new device is local until its first wire
  // materializes it into the committed routing. Selecting a device flips the
  // drawer to its Inspector tab.
  let neTab = $state<NodeEditorTab>('add');
  $effect(() => {
    if (shell.selection?.kind === 'patch') neTab = 'inspector';
  });
  const ADD_GROUPS: AddGroup[] = [
    {
      key: 'devices',
      label: 'Devices',
      items: [
        { id: 'dataline', name: 'Data Line', icon: Cable, tint: DEVICE_ROLE.dataline, hint: 'LED run' },
        { id: 'output', name: 'Output', icon: Plug, tint: DEVICE_ROLE.output, hint: 'controller port' },
      ],
    },
  ];
  let flowApi = $state<FlowApi | null>(null);
  let canvasWrap = $state<HTMLElement | null>(null);
  function handleAdd(id: string): void {
    const r = canvasWrap?.getBoundingClientRect();
    if (!flowApi) return;
    const c = flowApi.screenToFlowPosition(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 });
    addDevice(id as 'dataline' | 'output', c.x, c.y);
  }

  /** Plain-language reason for a refused fan-out wire — states what's wrong, no jargon
      (mirrors the Trigger graph's wire-toast copy conventions: one toast, one event). */
  const FANOUT_REJECTION_MESSAGE =
    "That hoop is already on a data line — a hoop can only drive one. Move its wire instead of adding a second.";

  /** Does the given PROSPECTIVE edge set drive any hoop from two data lines? Reads it back
      to a routing and asks S07's core rule (`hasHoopFanOut`) — one rule definition shared with
      the server backstop, never restated here. The live routing is kept fan-out-free (the two
      connect guards below + the backstop), so a prospective fan-out is always the pending
      mutation. Both the add path (`wouldFanOut`) and the re-point path (`onReconnect`) feed
      their candidate edge set through here so a connect gesture the engine would refuse is
      refused editor-side first. `kit` falls back to `DEFAULT_KIT` when the project is offline. */
  function edgesFanOut(prospective: PatchFlowEdge[]): boolean {
    const routing = routingFromGraph(nodes, prospective, scalarsFor, lineUniverseFor);
    return hasHoopFanOut(store.project?.kit ?? DEFAULT_KIT, routing);
  }

  /** Would ADDING the wire `c` fan a hoop onto a second data line? Probes the edge set with `c`
      appended (a NEW connect). The re-point path has its own guard in {@link onReconnect}. */
  function wouldFanOut(c: Connection): boolean {
    if (!c.source || !c.target) return false;
    const probe: PatchFlowEdge = { id: 'probe:fanout', source: c.source, target: c.target };
    return edgesFanOut([...edges, probe]);
  }

  /** Reject self-loops, exact duplicate wires, and fan-outs (a hoop wired to a second data
      line — S07's rule, enforced editor-side); otherwise accept (xyflow applies the default
      `wire` type so the new edge is reconnectable). A fan-out is the one rejection the user
      might not expect, so it surfaces the established error wire-toast; the structural
      self/dup rejects stay silent (they can't be produced by a deliberate gesture). */
  function onBeforeConnect(c: Connection): Connection | false {
    if (!c.source || !c.target || c.source === c.target) return false;
    if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
    if (wouldFanOut(c)) {
      pushToast(FANOUT_REJECTION_MESSAGE, { tone: 'error' });
      return false;
    }
    return c;
  }

  /** Group-A flow-guard hardening extended to the Patch graph (phase-2 item 1c): a throw
      inside an xyflow event callback becomes a reported fault (console + Monitor error
      event) AND a self-healing rebuild — mirroring TriggerGraphView's guard — instead of
      propagating into xyflow's internals and freezing the canvas with a half-applied local
      mutation on screen (S02). The rebuild re-derives the output half from the authoritative
      project outputs; the input half + controller sink are untouched. */
  function guard<A extends unknown[]>(where: string, fn: (...args: A) => void): (...args: A) => void {
    return guardFlowCallback(where, fn, (w, err) => {
      const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
      console.error(`[patch-graph] ${w} failed`, err);
      store.reportError('patch-graph', w, detail);
      forceRebuild();
    });
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
    commitRouting();
  }

  /** Re-point an existing wire (a reconnect-anchor drag re-points EITHER end). Rejects self /
      controller-as-source / input-as-target, an exact duplicate of another wire, and a fan-out:
      dragging the HOOP end onto a hoop that already drives a data line puts that hoop on TWO
      lines — a connect-gesture fan-out (S07's rule) the server would refuse, and the local
      project + canvas would durably hold the refused edit (the adopt $effect sees local ==
      lastSig, no snap-back). So the re-point runs the SAME fan-out guard as a new connect. On
      any rejection, snap the anchor back to the unchanged wire and do not recompile; otherwise
      update the ephemeral edge in place + recompile. */
  function onReconnect(oldEdge: { id: string }, conn: Connection): void {
    if (!conn.source || !conn.target || conn.source === conn.target) {
      edges = hover.decorate([...edges]); // snap the anchor back to the unchanged wire
      return;
    }
    if (stageOf(conn.source) === 'controller' || stageOf(conn.target) === 'input') {
      edges = hover.decorate([...edges]);
      return;
    }
    // An exact duplicate of a DIFFERENT existing wire — snap back (a no-op re-point).
    if (edges.some((e) => e.id !== oldEdge.id && e.source === conn.source && e.target === conn.target)) {
      edges = hover.decorate([...edges]);
      return;
    }
    const prospective = edges.map((e) =>
      e.id === oldEdge.id ? { ...e, source: conn.source!, target: conn.target! } : e,
    );
    if (edgesFanOut(prospective)) {
      pushToast(FANOUT_REJECTION_MESSAGE, { tone: 'error' });
      edges = hover.decorate([...edges]); // snap back — the engine would refuse this re-point
      return;
    }
    edges = hover.decorate(prospective);
    commitRouting();
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

  // Built ONCE, synchronously at mount, so the nodes exist for SvelteFlow's initial
  // `fitView` (populating them later via an $effect fits an empty graph and leaves the
  // viewport unfitted). The view remounts on re-entry, re-deriving from the store (incl.
  // the authoritative outputs) — so this stays data-driven without a reactive rebuild
  // that would fight SvelteFlow's drag-owned arrays. Hence $state.raw + two-way bind.
  // #11: the input half's hoop counts derive from the authoritative project kit (per-drum
  // override or global), like the output half — not from DEFAULT_KIT. Falls back to
  // DEFAULT_KIT only when offline (no project yet). See `topoDrumsFromKit`.
  const topoDrums = untrack(() =>
    topoDrumsFromKit(store.project?.kit ?? DEFAULT_KIT, store.drums, zonesForDrum),
  );
  const full = buildPatchTopology(topoDrums);

  // Layout anchors from the input half: column stride from the controller's x (it sits
  // in the last stage column) and the vertical centre from its y.
  const controllerNode = full.nodes.find((n) => n.data.stage === 'controller');
  const ctrlIdx = STAGE_ORDER.indexOf('controller');
  const midY = controllerNode?.position.y ?? 0;
  const colW = controllerNode && ctrlIdx > 0 ? controllerNode.position.x / ctrlIdx : 240;
  const colDataline = STAGE_ORDER.indexOf('dataline') * colW;
  const colOutput = STAGE_ORDER.indexOf('output') * colW;

  // Keep the input half (input→trigger→zone→drum→hoop) + the controller sink; drop the
  // topology's DEFAULT chunked output half — the authoritative one replaces it below.
  const keepStages = new Set<PatchStage>(['input', 'trigger', 'zone', 'drum', 'hoop', 'controller']);
  const inputNodes = full.nodes.filter((n) => keepStages.has(n.data.stage));
  const hoopIds = new Set(inputNodes.filter((n) => n.data.stage === 'hoop').map((n) => n.id));
  const dropIds = new Set(
    full.nodes.filter((n) => n.data.stage === 'dataline' || n.data.stage === 'output').map((n) => n.id),
  );
  const inputEdges = full.edges.filter((e) => !dropIds.has(e.source) && !dropIds.has(e.target));

  // Output half DERIVED from the authoritative project outputs (S2 compiler), or a
  // default chunk when the project declares none yet (offline / fresh project). Read
  // once at mount (untrack) — the view remounts to re-derive, like the input half.
  const initialOutputs = untrack(() => store.project?.kit.outputs) ?? [];
  const initialRouting = initialOutputs.length ? outputsToPatch(initialOutputs) : defaultRouting(topoDrums);
  const outHalf = buildOutputHalf(initialRouting, {
    colDataline,
    colOutput,
    controllerId: CONTROLLER_ID,
    midY,
    hasHoop: (id) => hoopIds.has(id),
  });

  let nodes = $state.raw<PatchFlowNode[]>([...inputNodes, ...outHalf.nodes]);
  // wire type so every edge end is a reconnect anchor.
  let edges = $state.raw<PatchFlowEdge[]>(
    hover.decorate([...inputEdges, ...outHalf.edges].map((e) => ({ ...e, type: 'wire' as const }))),
  );

  /** Per-output transport scalars the graph doesn't author — read from the authoritative
      project so a rewire preserves them (S4's Output inspector edits them via setRouting).
      `startUniverse` is optional: a project output without one packs dense. */
  function scalarsFor(outputId: string): OutputScalars {
    const o = store.project?.kit.outputs.find((x) => x.id === outputId);
    return o ? { startUniverse: o.startUniverse, channelsPerPixel: o.channelsPerPixel } : { channelsPerPixel: 3 };
  }

  /** A data line's optional `startUniverse` snap — recovered from the authoritative project
      by its owning output id + index within that output (the S6 data-line Inspector edits it
      via setRouting), so a set boundary survives a rewire. Absent → the line packs dense. */
  function lineUniverseFor(outputId: string, lineIndex: number): number | undefined {
    return store.project?.kit.outputs.find((x) => x.id === outputId)?.dataLines[lineIndex]?.startUniverse;
  }

  // Read the output half back into a routing, recompile to OutputConfig[], and push it —
  // but only when the result actually changed (a hover or input-half drag is a no-op).
  // `lastSig` is the canonical signature of the routing we last drew/committed/adopted; the
  // adopt $effect below compares it against the project's outputs to skip our own echo.
  let lastSig = routingSignature(initialRouting);
  function commitRouting(): void {
    const routing = routingFromGraph(nodes, edges, scalarsFor, lineUniverseFor);
    const sig = routingSignature(routing);
    if (sig === lastSig) return;
    lastSig = sig;
    store.setRouting(patchToOutputs(routing));
  }

  // The LIVE routing, datalines/outputs keyed by their graph NODE id (recomputed whenever
  // nodes/edges change: add, wire, reorder-by-drag, delete).
  const liveRouting = $derived(routingFromGraph(nodes, edges, scalarsFor, lineUniverseFor));

  /** Splice a freshly-derived output half onto the live input half, re-stamping the wire
      type and re-decorating uniformly. The node/edge splice math is the pure, unit-tested
      `rebuildOutputHalf`; this binds it to the view's reactive `nodes`/`edges` + hover. */
  function applyOutputHalf(routing: PatchRouting): void {
    const rebuilt = rebuildOutputHalf(routing, { nodes, edges }, {
      colDataline,
      colOutput,
      controllerId: CONTROLLER_ID,
      midY,
      hasHoop: (id) => hoopIds.has(id),
    });
    nodes = rebuilt.nodes;
    edges = hover.decorate(rebuilt.edges.map((e) => ({ ...e, type: 'wire' as const })));
  }

  /** Rebuild ONLY the output half (dataline → output → controller) from an authoritative
      `OutputConfig[]`, leaving the input half + controller sink and their edges intact
      (positions of surviving output nodes preserved so an external change doesn't fight a
      layout the user has nudged — memory: locked graph UX). */
  function adoptOutputs(outputs: OutputConfig[]): void {
    applyOutputHalf(outputsToPatch(outputs));
  }

  /** Self-heal after a guarded fault: drop any half-applied local mutation by re-deriving the
      output half from the authoritative project outputs (or the default chunk when the project
      declares none), so a thrown handler heals in place instead of leaving a stale/blank canvas
      until a page refresh (S02, mirrors TriggerGraphView.forceRebuild). `lastSig` is synced to
      the rebuilt routing so the cold-load adopt $effect sees no divergence and stays quiet. */
  function forceRebuild(): void {
    const outputs = store.project?.kit.outputs ?? [];
    const routing = outputs.length ? outputsToPatch(outputs) : defaultRouting(topoDrums);
    applyOutputHalf(routing);
    lastSig = routingSignature(routing);
  }

  // COLD-LOAD ADOPT: the output half is seeded ONCE at mount from `untrack`ed outputs — null on
  // a cold load → the default chunk — but the server's real `kit.outputs` only arrive in a later
  // WS `state`. This $effect tracks ONLY `store.project.kit.outputs`; when their canonical
  // signature differs from BOTH what we last drew/committed (`lastSig`) AND what's literally on
  // the canvas now (`liveRouting`, read untracked so a drag doesn't re-run us), it rebuilds the
  // output half from them. So: the first arrival adopts; the echo of the user's own just-committed
  // rewire (the optimistic write + its server round-trip) is a no-op; a genuine external change
  // (reconnect to a server with different outputs) adopts — without clobbering an in-progress local
  // rewire (uncommitted, so `store.project` hasn't changed to trigger us yet).
  $effect(() => {
    const outputs = store.project?.kit.outputs;
    if (!outputs || outputs.length === 0) return; // no authoritative routing yet (offline / fresh)
    const incomingSig = outputsSignature(outputs);
    if (incomingSig === lastSig) return; // already in sync — incl. the echo of our own edit
    untrack(() => {
      // Matches what's literally drawn (a just-committed / in-progress rewire)? Adopt the sig only.
      if (incomingSig === routingSignature(liveRouting)) {
        lastSig = incomingSig;
        return;
      }
      adoptOutputs(outputs);
      lastSig = incomingSig;
    });
  });

  // Publish it to the shell so the Inspector's first/last-pixel read-out reflects the current
  // wiring — including a just-added palette data line and an un-remounted reorder — instead of
  // a re-chunked snapshot of committed outputs whose synthetic ids never match the selected
  // node. Syncing a derived to an external store is exactly what $effect is for; cleared on
  // unmount so a stale routing never outlives the view.
  $effect(() => {
    shell.setPatchRouting(liveRouting);
  });
  onDestroy(() => shell.setPatchRouting(null));
</script>

<div class="patch-view">
  <div class="phead">
    <PanelHeader icon={Cable} title="Patch Graph">
      <div class="ptools">
        <PatchMirrorControl {store} />
        <PatchClipboardToolbar {store} />
      </div>
    </PanelHeader>
  </div>

  <div class="prow">
    <div class="gwrap" bind:this={canvasWrap}>
      <GraphCanvas
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        defaultEdgeOptions={{ type: 'wire' }}
        fitPadding={0.15}
        minimap
        onFlow={(f) => (flowApi = f)}
        onBeforeConnect={onBeforeConnect}
        onNodeClick={(id) => shell.select({ kind: 'patch', nodeId: id })}
        onPaneClick={() => shell.clearSelection()}
        onNodeEnter={onEnter}
        onNodeLeave={onLeave}
        onConnect={guard('connect', () => commitRouting())}
        onReconnect={guard('reconnect', onReconnect)}
        onDelete={guard('delete', () => commitRouting())}
        onNodeDragStop={guard('drag', () => commitRouting())}
        onConnectEnd={guard('connect-end', (event, conn) => {
          if (conn.toHandle || !conn.fromHandle) return; // already landed on a handle
          const toId = nodeIdAtEvent(event);
          if (toId) dropConnect(conn.fromHandle.nodeId, conn.fromHandle.type, toId);
        })}
      />
    </div>

    <NodeEditor bind:tab={neTab}>
      {#snippet add()}
        <AddPalette groups={ADD_GROUPS} onAdd={handleAdd} disabled={!store.canEdit} />
      {/snippet}
      {#snippet inspector()}
        <Inspector {store} {shell} />
      {/snippet}
    </NodeEditor>
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
  .phead {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  /* The header IS the whole card here — drop PanelHeader's border-bottom so the card
     shows a single clean edge. */
  .phead :global(.panel-hd) {
    border-bottom: none;
  }
  /* Toolbar cluster in the header slot: mirror control + clipboard tools, right-aligned. */
  .ptools {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
</style>
