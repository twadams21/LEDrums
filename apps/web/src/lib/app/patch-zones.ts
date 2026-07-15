/* Patch Graph v2 zone model (D1) — the PURE builder for the zone-based canvas: three holder
   zones (Controller / Drum Kit / Drum Triggers) as TRUE xyflow `parentId` containers, the Drum
   Kit nesting drum sub-zones that hold hoop nodes, and the physical `Output → Hoop → Hoop …`
   chain wiring. No Svelte / DOM here so the geometry + wire-rule adapter are unit-testable;
   `PatchGraphView.svelte` is a thin consumer.

   NESTING (2 real levels — nodes emitted ANCESTORS-FIRST, xyflow's requirement):
     controller (zone, no parent)  → Output leaves    (parentId = controller)
     kit        (zone, no parent)  → drum sub-zones   (parentId = kit)
       drum:<id> (zone, parent=kit) → Hoop leaves      (parentId = drum:<id>)
     triggers   (zone, no parent)  → Trigger leaves   (parentId = triggers)
   A parent drag moves its whole subtree (native xyflow); cascade + grouping come for free.

   COORDINATES ARE PARENT-RELATIVE. A leaf's `position` is relative to its immediate parent
   zone's origin (a hoop rel to its drum sub-zone, a drum sub-zone rel to kit, an output rel to
   controller, a trigger rel to triggers). The three top holders carry ABSOLUTE canvas positions.

   LAYOUT IS MANUAL + PERSISTED, NOT AUTO. Positions are seeded ONCE deterministically then
   frozen into `kit.nodeLayout` (a node absent from the map gets its seed; a present node uses
   the stored value). `kit.nodeLayout` stores each node's xyflow `position` — PARENT-RELATIVE for
   a child, absolute for a top holder (same `Record<string,{x,y}>` schema; only the frame of
   reference is relative now). The graph never re-flows on its own.

   AUTO-FIT WITH parentId ({@link autoFitContainers}). xyflow does NOT grow a parent to its
   children — we compute it, bottom-up, in each parent's local frame: size the container to its
   direct children's bounding box (+pad), then RE-NORMALIZE (shift the container's position by the
   children's min corner and subtract that from every child so they stay put visually and the box
   origin hugs them). This keeps the drag-reflow feel — drag a hoop → its drum zone grows/follows
   → the kit follows — WITHOUT a hard `extent:'parent'` clamp (which would fight the auto-grow).

   WIRING RULES LIVE IN CORE. Only `Output → Hoop` and `Hoop → Hoop` wires are legal; the per-wire
   structural guard is core's {@link classifyChainConnection} (mutation-parity by construction —
   the same rule the server backstop runs). This module only ADAPTS graph node ids / edges to
   core's `ChainEdge` vocabulary; it never restates a rule. */

import type { Node } from '@xyflow/svelte';
import { classifyChainConnection, type ChainConnectionVerdict, type ChainEdge, type HoopRef } from '@ledrums/core';
import { hoopNodeId, outputNodeId, parseHoopNodeId, parseOutputNodeId } from './patch-graph';
import { NODE_H, NODE_W, type PatchFlowEdge, type PatchFlowNode } from './patch-topology';
import type { PatchRouting } from './patch-routing';

// --- holder zone ids (top-level, no ':' so they don't collide with `hoop:`/`output:`/`drum:`) --
export const CONTROLLER_ZONE_ID = 'controller';
export const KIT_ZONE_ID = 'kit';
export const TRIGGERS_ZONE_ID = 'triggers';

/** Flow-node id for a drum sub-zone (also its Inspector selection id → the drum editor). */
export const drumZoneId = (drumId: string): string => `drum:${drumId}`;
/** Flow-node id for a trigger node. */
export const triggerNodeId = (drumId: string): string => `trigger:${drumId}`;

/** The kind of holder/sub zone (drives the icon, tint, and Inspector routing). */
export type PatchZoneKind = 'controller' | 'kit' | 'drum' | 'triggers';

/** Data carried on a `zone`-type flow node (a labelled, auto-fitting container). */
export type PatchZoneData = {
  kind: PatchZoneKind;
  label: string;
  /** CSS custom-property reference for this zone's role tint. */
  role: string;
  /** True for a drum SUB-zone (nested inside the Kit zone) — a subtler container treatment. */
  sub: boolean;
};

export type PatchZoneNode = Node<PatchZoneData> & { type: 'zone' };

/** Role tint per zone kind (design-system role tokens). */
const ZONE_ROLE: Record<PatchZoneKind, string> = {
  controller: 'var(--role-output)',
  kit: 'var(--role-layer)',
  drum: 'var(--role-layer)',
  triggers: 'var(--role-input)',
};

/** A 2D position (canvas px for a top holder, parent-relative px for a child). */
export type XY = { x: number; y: number };

/** A drum as the zone builder needs it: identity + label + hoop count. */
export interface ZoneDrum {
  id: string;
  label: string;
  hoopCount: number;
}

/** Which drums expose a trigger node (bound to their drum by identity). */
export interface ZoneTrigger {
  drumId: string;
  label: string;
  /** Secondary mono line, e.g. "2 zones". */
  sub: string;
}

/** Everything the builder needs from the project to draw the zone graph. */
export interface ZoneGraphInput {
  drums: ZoneDrum[];
  routing: PatchRouting;
  triggers: ZoneTrigger[];
}

// --- grid ---------------------------------------------------------------------------

/** The snap grid (px). The canvas snaps dragged nodes to it, the background dots sit on it, and
    {@link autoFitContainers} quantises every container's origin + size to it — so a container's
    EDGES land on grid lines and the gap to its children is a whole number of cells (the "grid
    gives the padding"). All seed geometry below is grid-aligned so a fresh graph is already
    canonical (autoFit is a no-op on it). Exported for the view (snapGrid + background gap). */
export const GRID = 20;

/** Round to the nearest grid line (for positions — matches the canvas's own snap-to-grid). */
const snapGrid = (v: number): number => Math.round(v / GRID) * GRID;
/** Round UP to a grid line (for sizes + paddings — guarantees the far edge clears the children). */
const ceilGrid = (v: number): number => Math.ceil(v / GRID) * GRID;

// --- padding + seed geometry -------------------------------------------------------

/** Inner padding around a zone's children (x sides, top leaves room for the label, bottom).
    Grid-aligned so a container's edges land on grid lines. The Kit zone's larger pad wraps the
    nested drum sub-zones; a sub-zone hugs its hoops. */
const PAD: Record<PatchZoneKind, { x: number; top: number; bottom: number }> = {
  drum: { x: 20, top: 40, bottom: 20 },
  controller: { x: 20, top: 40, bottom: 20 },
  triggers: { x: 20, top: 40, bottom: 20 },
  kit: { x: 20, top: 40, bottom: 40 },
};

// Gaps chosen so each stride (node + gap) is a whole number of grid cells, keeping every seeded
// node on the grid: 176+24=200, 48+32=80 (both multiples of GRID=20).
const SEED = {
  x0: 40, // controller's canvas x (grid-aligned)
  y0: 120, // top zones' canvas y (grid-aligned)
  zoneGap: 80, // horizontal gap between the three top holders
  colGap: 24, // gap between hoops in a drum's row (176+24 = 200)
  rowGap: 32, // gap between drum sub-zones stacked in the kit (drumH 108 + 32 = 140)
  stackGap: 32, // gap between stacked outputs / triggers (48+32 = 80)
};

const zIndexFor = (kind: PatchZoneKind): number => (kind === 'drum' ? 1 : 0);
const LEAF_Z = 10;

function leafRole(stage: 'output' | 'hoop' | 'trigger'): string {
  return ZONE_ROLE[stage === 'trigger' ? 'triggers' : stage === 'output' ? 'controller' : 'kit'];
}

function leafNode(id: string, parentId: string, position: XY, stage: 'output' | 'hoop' | 'trigger', label: string, sub: string, terminal?: boolean): PatchFlowNode {
  return {
    id,
    type: 'patch',
    parentId,
    position,
    initialWidth: NODE_W,
    initialHeight: NODE_H,
    zIndex: LEAF_Z,
    data: { label, sub, stage, role: leafRole(stage), ...(terminal === undefined ? {} : { terminal }) },
  };
}

function zoneNode(id: string, kind: PatchZoneKind, label: string, position: XY, size: { w: number; h: number }, parentId?: string): PatchZoneNode {
  return {
    id,
    type: 'zone',
    ...(parentId ? { parentId } : {}),
    position,
    width: size.w,
    height: size.h,
    selectable: true,
    draggable: true, // a parent drag moves its whole subtree (the point of parentId)
    connectable: false,
    zIndex: zIndexFor(kind),
    data: { kind, label, role: ZONE_ROLE[kind], sub: kind === 'drum' },
  };
}

/**
 * Seed the full node tree deterministically (ancestors-first), in the parent-relative model:
 * the three top holders at absolute canvas positions, drum sub-zones relative to the kit, and
 * leaves relative to their holder/sub-zone. Container sizes are computed to hug their children,
 * so a fresh seed is already canonical ({@link autoFitContainers} is a no-op on it).
 */
function seedTree(input: ZoneGraphInput): Node[] {
  const topZones: PatchZoneNode[] = [];
  const drumZones: PatchZoneNode[] = [];
  const leaves: PatchFlowNode[] = [];

  // A hoop is TERMINAL unless the routing wires a downstream hoop after it — i.e. every hoop
  // except the LAST of each output's run has a source handle (it feeds the next hoop). Unwired
  // hoops (in no run) are terminal too. Drives the per-hoop source-handle gate in PatchNode.
  const nonTerminalHoops = new Set<string>();
  for (const output of input.routing.outputs) {
    for (let i = 0; i < output.hoops.length - 1; i++) nonTerminalHoops.add(hoopNodeId(output.hoops[i]!));
  }

  // --- Drum Kit: size each drum sub-zone from its hoops, then stack them in the kit ---
  const drumH = PAD.drum.top + NODE_H + PAD.drum.bottom;
  let ky = PAD.kit.top;
  let kitInnerW = 0;
  for (const d of input.drums) {
    const drumW = PAD.drum.x * 2 + Math.max(1, d.hoopCount) * NODE_W + Math.max(0, d.hoopCount - 1) * SEED.colGap;
    for (let h = 1; h <= d.hoopCount; h++) {
      const hId = hoopNodeId({ drumId: d.id, hoop: h });
      leaves.push(leafNode(hId, drumZoneId(d.id), { x: PAD.drum.x + (h - 1) * (NODE_W + SEED.colGap), y: PAD.drum.top }, 'hoop', `${d.label} · Hoop ${h}`, 'LED hoop', !nonTerminalHoops.has(hId)));
    }
    drumZones.push(zoneNode(drumZoneId(d.id), 'drum', d.label, { x: PAD.kit.x, y: ky }, { w: drumW, h: drumH }, KIT_ZONE_ID));
    ky += drumH + SEED.rowGap;
    kitInnerW = Math.max(kitInnerW, drumW);
  }
  const kitW = PAD.kit.x * 2 + kitInnerW;
  const kitH = (input.drums.length ? ky - SEED.rowGap : PAD.kit.top) + PAD.kit.bottom;

  // --- Controller: stack the outputs ---
  input.routing.outputs.forEach((o, i) => {
    const n = o.hoops.length;
    leaves.push(leafNode(outputNodeId(o.id), CONTROLLER_ZONE_ID, { x: PAD.controller.x, y: PAD.controller.top + i * (NODE_H + SEED.stackGap) }, 'output', `Output ${i + 1}`, n === 0 ? 'unwired' : `${n} hoop${n === 1 ? '' : 's'}`));
  });
  const nOut = input.routing.outputs.length;
  const ctrlW = PAD.controller.x * 2 + NODE_W;
  const ctrlH = PAD.controller.top + Math.max(1, nOut) * NODE_H + Math.max(0, nOut - 1) * SEED.stackGap + PAD.controller.bottom;

  // --- Drum Triggers: stack the triggers ---
  input.triggers.forEach((t, i) => {
    leaves.push(leafNode(triggerNodeId(t.drumId), TRIGGERS_ZONE_ID, { x: PAD.triggers.x, y: PAD.triggers.top + i * (NODE_H + SEED.stackGap) }, 'trigger', t.label, t.sub));
  });
  const nTrg = input.triggers.length;
  const trgW = PAD.triggers.x * 2 + NODE_W;
  const trgH = PAD.triggers.top + Math.max(1, nTrg) * NODE_H + Math.max(0, nTrg - 1) * SEED.stackGap + PAD.triggers.bottom;

  // --- Top holders at absolute positions, left→right (grid-snapped so their edges land on the
  //     grid — their widths are ceilGrid'd by autoFit, so left+right both sit on grid lines). ---
  const ctrlX = snapGrid(SEED.x0);
  const kitX = snapGrid(ctrlX + ctrlW + SEED.zoneGap);
  const trgX = snapGrid(kitX + kitW + SEED.zoneGap);
  topZones.push(zoneNode(CONTROLLER_ZONE_ID, 'controller', 'Controller', { x: ctrlX, y: SEED.y0 }, { w: ctrlW, h: ctrlH }));
  topZones.push(zoneNode(KIT_ZONE_ID, 'kit', 'Drum Kit', { x: kitX, y: SEED.y0 }, { w: kitW, h: kitH }));
  topZones.push(zoneNode(TRIGGERS_ZONE_ID, 'triggers', 'Drum Triggers', { x: trgX, y: SEED.y0 }, { w: trgW, h: trgH }));

  // Ancestors-first: top holders, then drum sub-zones, then all leaves.
  return [...topZones, ...drumZones, ...leaves];
}

// --- auto-fit (bottom-up size + re-normalize) --------------------------------------

/** Direct-child size in its parent's frame: a leaf's measured/seed card size, or a zone's own
    computed width/height (set earlier this pass, since we go bottom-up). */
function sizeOf(n: Node): { w: number; h: number } {
  if (n.type === 'zone') return { w: n.width ?? NODE_W, h: n.height ?? NODE_H };
  return { w: n.measured?.width ?? n.initialWidth ?? NODE_W, h: n.measured?.height ?? n.initialHeight ?? NODE_H };
}

/** Depth of a node in the parentId tree (0 = a top holder). */
function depthOf(n: Node, byId: Map<string, Node>): number {
  let d = 0;
  let p = n.parentId;
  while (p) {
    d++;
    p = byId.get(p)?.parentId;
  }
  return d;
}

/**
 * Recompute every container's size to hug its direct children and RE-NORMALIZE so a child dragged
 * toward the top-left grows the box instead of clipping. Processes containers DEEPEST-FIRST (drum
 * sub-zones before the kit) so nested frames stay consistent. Pure: returns a new nodes array
 * (positions/sizes cloned); the input is untouched. An empty container is left as-is.
 */
export function autoFitContainers(nodes: ReadonlyArray<Node>): Node[] {
  const clone: Node[] = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const byId = new Map(clone.map((n) => [n.id, n]));
  const childrenOf = new Map<string, Node[]>();
  for (const n of clone) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n);
      childrenOf.set(n.parentId, arr);
    }
  }

  const containers = clone.filter((n) => n.type === 'zone').sort((a, b) => depthOf(b, byId) - depthOf(a, byId));
  for (const c of containers) {
    const kids = childrenOf.get(c.id) ?? [];
    if (!kids.length) continue;
    const pad = PAD[(c.data as PatchZoneData).kind];
    // Paddings are quantised to the grid so the gap from a container edge to its children is a
    // whole number of cells (grid-provided padding).
    const padL = ceilGrid(pad.x);
    const padT = ceilGrid(pad.top);
    const padB = ceilGrid(pad.bottom);
    const rects = kids.map((k) => {
      const s = sizeOf(k);
      return { x: k.position.x, y: k.position.y, w: s.w, h: s.h };
    });
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    // Shift the container so its topmost/leftmost child sits exactly at the (grid-aligned) pad,
    // compensating the children so they stay put visually. When the child min corner and the
    // container's own origin are already grid-aligned (seeds are; drags snap to grid), this offset
    // is a whole number of cells, so the container's origin stays on the grid — and because a fresh
    // seed already satisfies min == pad the whole pass is a no-op on it (idempotent).
    const offX = minX - padL;
    const offY = minY - padT;
    c.position.x += offX;
    c.position.y += offY;
    for (const k of kids) {
      k.position.x -= offX;
      k.position.y -= offY;
    }
    // Size ceils to the grid so the FAR edge also lands on a grid line (≥ children + pad).
    c.width = ceilGrid(maxX - offX + padL);
    c.height = ceilGrid(maxY - offY + padB);
  }
  return clone;
}

// --- FU1: live cross-client nodeLayout sync ----------------------------------------

/** A stable signature of a persisted layout map (id→position, rounded to integer px). Dedupes a
    client's OWN `kit.nodeLayout` persist echo from a genuine peer change — the layout analogue of
    the routing adopt's `outputsSignature`. Order-independent (ids sorted); px rounding absorbs the
    sub-pixel jitter an autoFit re-normalization can introduce, so an own-echo never reads as new. */
export function layoutSignature(map: Record<string, XY> | undefined): string {
  if (!map) return '';
  return Object.keys(map)
    .sort()
    .map((id) => `${id}:${Math.round(map[id]!.x)},${Math.round(map[id]!.y)}`)
    .join('|');
}

/** FU1 — adopt an externally-authored layout (a peer's drag, echoed by the server) onto the live
    nodes: reposition every node the map names, then re-fit the auto-sizing containers so the zones
    reflow to hug their moved members (same reposition→autoFit path as {@link buildZoneGraph}).
    Positions only — routing/edges are untouched and the caller NEVER persists from here, so there
    is no feedback loop. Idempotent: adopting a layout that already matches the nodes' positions is
    a fixed point (autoFitContainers is), so re-adopting our own echo can't drift the canvas. */
export function adoptLayoutNodes(nodes: ReadonlyArray<Node>, layout: Record<string, XY>): Node[] {
  return autoFitContainers(nodes.map((n) => (layout[n.id] ? { ...n, position: { ...layout[n.id]! } } : n)));
}

// --- build the full graph ----------------------------------------------------------

/**
 * Build the full ancestors-first node tree (top holders → drum sub-zones → leaves) with parentId
 * wiring and parent-relative positions, applying persisted `kit.nodeLayout` overrides then
 * auto-fitting every container. `layout` values are in the SAME relative/absolute frame as the
 * nodes (a child's stored value is parent-relative; a top holder's is absolute).
 */
export function buildZoneGraph(input: ZoneGraphInput, layout: Record<string, XY> | undefined): Node[] {
  const seeded = seedTree(input);
  const overridden = layout
    ? seeded.map((n) => (layout[n.id] ? { ...n, position: { ...layout[n.id]! } } : n))
    : seeded;
  return autoFitContainers(overridden);
}

// --- physical chain + reference edges ----------------------------------------------

/** Build the physical `Output → Hoop → Hoop …` chain edges that DRAW a routing (only for hoops
    that exist as nodes). One edge per wire; the view stamps the `wire` edge type + hover class. */
export function buildChainEdges(routing: PatchRouting, hasNode: (id: string) => boolean): PatchFlowEdge[] {
  const edges: PatchFlowEdge[] = [];
  for (const output of routing.outputs) {
    let prev = outputNodeId(output.id);
    const seen = new Set<string>();
    for (const ref of output.hoops) {
      const hId = hoopNodeId(ref);
      if (seen.has(hId)) continue;
      seen.add(hId);
      if (hasNode(hId)) edges.push({ id: `${prev}->${hId}`, source: prev, target: hId });
      prev = hId;
    }
  }
  return edges;
}

/** Build the greyed, dotted, NON-interactive Trigger → Drum reference edges (binding by identity;
    they carry no routing). Targets the drum SUB-ZONE node so the wire reads to the whole drum. */
export function buildRefEdges(triggers: ReadonlyArray<ZoneTrigger>, hasDrumZone: (drumId: string) => boolean): PatchFlowEdge[] {
  return triggers
    .filter((t) => hasDrumZone(t.drumId))
    .map((t) => ({
      id: `ref:${t.drumId}`,
      source: triggerNodeId(t.drumId),
      target: drumZoneId(t.drumId),
      type: 'ref',
      selectable: false,
      deletable: false,
      data: { ref: true },
    }));
}

// --- wire-rule adapter (graph ids ⇄ core ChainEdge) --------------------------------

/** Decode a flow-node id into a core wire SOURCE, or null if it is not a legal source
    (only Output and Hoop nodes can start/continue a chain). */
function chainSourceOf(nodeId: string): ChainEdge['from'] | null {
  const outputId = parseOutputNodeId(nodeId);
  if (outputId !== null) return { kind: 'output', outputId };
  const ref = parseHoopNodeId(nodeId);
  return ref ? { kind: 'hoop', ref } : null;
}

/** Decode a flow-node id into a target HoopRef, or null if it is not a hoop node. */
function targetHoopOf(nodeId: string): HoopRef | null {
  return parseHoopNodeId(nodeId);
}

/** Project the live graph's chain edges (`output→hoop` / `hoop→hoop`) into core `ChainEdge[]`.
    Ref edges + any stray wire are ignored (only legal source→hoop pairs contribute). */
export function graphChainEdges(edges: ReadonlyArray<PatchFlowEdge>): ChainEdge[] {
  const out: ChainEdge[] = [];
  for (const e of edges) {
    if (e.type === 'ref') continue;
    const from = chainSourceOf(e.source);
    const to = targetHoopOf(e.target);
    if (from && to) out.push({ from, to });
  }
  return out;
}

/**
 * Classify a prospective wire between two graph nodes against core's chain rules — the ONE guard
 * the connect UX and the server backstop share. Returns the core verdict (with its user-facing
 * `message` on rejection). A candidate whose ends aren't a legal `source → hoop` pair is rejected
 * with a plain message before core is consulted (core only speaks in already-typed ChainEdges).
 */
export function classifyGraphConnection(
  edges: ReadonlyArray<PatchFlowEdge>,
  sourceId: string,
  targetId: string,
): ChainConnectionVerdict {
  const to = targetHoopOf(targetId);
  if (!to) return { ok: false, code: 'hoop-has-upstream', message: 'Only a hoop can receive a wire — drop onto a hoop.' };
  const from = chainSourceOf(sourceId);
  if (!from) return { ok: false, code: 'hoop-has-upstream', message: 'A wire must start at an Output or a Hoop.' };
  return classifyChainConnection([...graphChainEdges(edges)], { from, to });
}
