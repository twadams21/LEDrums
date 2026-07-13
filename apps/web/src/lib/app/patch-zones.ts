/* Patch Graph v2 zone model (D1) — the PURE builder for the zone-based canvas: three holder
   zones (Controller / Drum Kit / Drum Triggers), the Drum Kit nesting drum sub-zones that hold
   hoop nodes, and the physical `Output → Hoop → Hoop …` chain wiring. No Svelte / DOM here so
   the geometry + wire-rule adapter are unit-testable; `PatchGraphView.svelte` is a thin consumer.

   LAYOUT IS MANUAL + PERSISTED, NOT AUTO. Leaf nodes (Output / Hoop / Trigger) carry ABSOLUTE
   canvas positions, seeded ONCE deterministically from the kit then frozen into `kit.nodeLayout`
   (a node absent from the map gets its seed; a present node uses the stored position). The graph
   never re-flows on its own. The three holder zones + drum sub-zones are NOT stored — they
   AUTO-FIT the bounding box of their member leaves (+padding), recomputed live so moving a hoop
   reflows its drum zone (mirrors the design-direction prototype). The Kit zone wraps ALL hoops
   with a larger pad so it encloses the drum sub-zones nested inside it.

   WIRING RULES LIVE IN CORE. Only `Output → Hoop` and `Hoop → Hoop` wires are legal; the per-wire
   structural guard is core's {@link classifyChainConnection} (mutation-parity by construction —
   the same rule the server backstop runs). This module only ADAPTS the graph's node ids / edges
   to core's `ChainEdge` vocabulary; it never restates a rule. */

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

/** Data carried on a `zone`-type flow node (an auto-fitting labelled container). */
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

// --- deterministic seed layout -----------------------------------------------------

/** A 2D canvas position. */
export type XY = { x: number; y: number };

/** Seed geometry constants — a clean, readable first arrangement (frozen into `nodeLayout`). */
const SEED = {
  topY: 120, // first row's y
  ctrlX: 60, // controller output column
  kitX: 380, // first hoop column of the kit
  colGap: 40, // horizontal gap between hoops in a drum's row
  rowGap: 92, // vertical gap between drum rows (leaves room for a drum sub-zone)
  outGap: 28, // vertical gap between stacked outputs
  trgGap: 140, // gap from the last hoop column to the trigger column
};

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

/**
 * Deterministic seed position for EVERY leaf node id (outputs, hoops, triggers) — the one-time
 * arrangement used when a node is absent from `kit.nodeLayout`. Outputs stack in the controller
 * column; each drum's hoops lay out in a horizontal row; triggers sit to the right of the kit,
 * aligned to their drum's row. Pure + total (a stable function of the kit structure).
 */
export function seedLeafPositions(input: ZoneGraphInput): Record<string, XY> {
  const seed: Record<string, XY> = {};

  // Controller: outputs stacked vertically.
  input.routing.outputs.forEach((o, i) => {
    seed[outputNodeId(o.id)] = { x: SEED.ctrlX, y: SEED.topY + i * (NODE_H + SEED.outGap) };
  });

  // Drum Kit: one horizontal row of hoops per drum; drums stacked top→bottom.
  const maxHoops = Math.max(1, ...input.drums.map((d) => d.hoopCount));
  input.drums.forEach((d, di) => {
    const rowY = SEED.topY + di * (NODE_H + SEED.rowGap);
    for (let h = 1; h <= d.hoopCount; h++) {
      seed[hoopNodeId({ drumId: d.id, hoop: h })] = { x: SEED.kitX + (h - 1) * (NODE_W + SEED.colGap), y: rowY };
    }
  });

  // Drum Triggers: to the right of the widest hoop row, aligned to each trigger's drum row.
  const trgX = SEED.kitX + maxHoops * (NODE_W + SEED.colGap) + SEED.trgGap;
  for (const t of input.triggers) {
    const di = input.drums.findIndex((d) => d.id === t.drumId);
    seed[triggerNodeId(t.drumId)] = { x: trgX, y: SEED.topY + (di < 0 ? 0 : di) * (NODE_H + SEED.rowGap) };
  }

  return seed;
}

/** Resolve a leaf's position: the persisted `nodeLayout` entry wins, else the deterministic seed. */
function positionFor(id: string, seed: Record<string, XY>, layout: Record<string, XY> | undefined): XY {
  return layout?.[id] ?? seed[id] ?? { x: 0, y: 0 };
}

// --- leaf nodes --------------------------------------------------------------------

/** Build the leaf flow nodes (Output / Hoop / Trigger) at their resolved absolute positions. */
export function buildLeafNodes(input: ZoneGraphInput, layout: Record<string, XY> | undefined): PatchFlowNode[] {
  const seed = seedLeafPositions(input);
  const nodes: PatchFlowNode[] = [];
  const leaf = (id: string, stage: 'output' | 'hoop' | 'trigger', label: string, sub: string): void => {
    nodes.push({
      id,
      type: 'patch',
      position: positionFor(id, seed, layout),
      initialWidth: NODE_W,
      initialHeight: NODE_H,
      data: { label, sub, stage, role: ZONE_ROLE[stage === 'trigger' ? 'triggers' : stage === 'output' ? 'controller' : 'kit'] },
    });
  };

  input.routing.outputs.forEach((o, i) => {
    const n = o.hoops.length;
    leaf(outputNodeId(o.id), 'output', `Output ${i + 1}`, n === 0 ? 'unwired' : `${n} hoop${n === 1 ? '' : 's'}`);
  });
  for (const d of input.drums) {
    for (let h = 1; h <= d.hoopCount; h++) {
      leaf(hoopNodeId({ drumId: d.id, hoop: h }), 'hoop', `${d.label} · Hoop ${h}`, 'LED hoop');
    }
  }
  for (const t of input.triggers) leaf(triggerNodeId(t.drumId), 'trigger', t.label, t.sub);

  return nodes;
}

// --- auto-fit zone nodes -----------------------------------------------------------

/** Padding around a zone's member leaves. The Kit zone uses a larger pad so it ENCLOSES the drum
    sub-zones nested inside it; a sub-zone hugs its hoops; the two flat holders sit between. */
const PAD = {
  sub: { x: 16, top: 30, bottom: 16 },
  holder: { x: 22, top: 34, bottom: 20 },
  kit: { x: 40, top: 54, bottom: 38 },
};

type Rect = { x: number; y: number; w: number; h: number };

/** Bounding box of the given leaf ids (using each leaf's measured or seeded size), expanded by
    `pad`; null when no member is present. */
function boundsOf(ids: string[], posById: Map<string, XY>, sizeById: Map<string, { w: number; h: number }>, pad: { x: number; top: number; bottom: number }): Rect | null {
  const rs = ids
    .map((id) => {
      const p = posById.get(id);
      if (!p) return null;
      const s = sizeById.get(id) ?? { w: NODE_W, h: NODE_H };
      return { x: p.x, y: p.y, w: s.w, h: s.h };
    })
    .filter((r): r is Rect => r !== null);
  if (!rs.length) return null;
  const minX = Math.min(...rs.map((r) => r.x));
  const minY = Math.min(...rs.map((r) => r.y));
  const maxX = Math.max(...rs.map((r) => r.x + r.w));
  const maxY = Math.max(...rs.map((r) => r.y + r.h));
  return { x: minX - pad.x, y: minY - pad.top, w: maxX - minX + pad.x * 2, h: maxY - minY + pad.top + pad.bottom };
}

/**
 * Compute the AUTO-FIT zone nodes (three holders + one sub-zone per drum) from the CURRENT leaf
 * node positions/sizes — the bounding box of each zone's member leaves. Recompute this whenever
 * a leaf moves (a drag) so the zones reflow to contain their members. A zone with no members is
 * omitted. Zones sort BEFORE leaves in the returned array and carry a low `zIndex` so they render
 * behind the leaves (and never intercept a leaf click).
 */
export function computeZoneNodes(leafNodes: ReadonlyArray<PatchFlowNode>, drums: ReadonlyArray<ZoneDrum>): PatchZoneNode[] {
  const posById = new Map<string, XY>(leafNodes.map((n) => [n.id, n.position]));
  const sizeById = new Map<string, { w: number; h: number }>(
    leafNodes.map((n) => [n.id, { w: n.measured?.width ?? n.initialWidth ?? NODE_W, h: n.measured?.height ?? n.initialHeight ?? NODE_H }]),
  );
  const stageOf = (id: string): string | undefined => leafNodes.find((n) => n.id === id)?.data.stage;
  const idsByStage = (stage: string): string[] => leafNodes.filter((n) => n.data.stage === stage).map((n) => n.id);

  const zones: PatchZoneNode[] = [];
  const push = (id: string, kind: PatchZoneKind, label: string, sub: boolean, rect: Rect | null): void => {
    if (!rect) return;
    zones.push({
      id,
      type: 'zone',
      position: { x: rect.x, y: rect.y },
      width: rect.w,
      height: rect.h,
      selectable: true,
      draggable: false,
      connectable: false,
      zIndex: sub ? 1 : 0,
      data: { kind, label, role: ZONE_ROLE[kind], sub },
    });
  };

  const hoopIds = idsByStage('hoop');
  void stageOf; // (kept for clarity; membership below is by stage/drum)

  // Controller holder wraps the outputs; Triggers holder wraps the triggers.
  push(CONTROLLER_ZONE_ID, 'controller', 'Controller', false, boundsOf(idsByStage('output'), posById, sizeById, PAD.holder));
  push(TRIGGERS_ZONE_ID, 'triggers', 'Drum Triggers', false, boundsOf(idsByStage('trigger'), posById, sizeById, PAD.holder));
  // Kit holder wraps ALL hoops with a larger pad so it encloses the drum sub-zones.
  push(KIT_ZONE_ID, 'kit', 'Drum Kit', false, boundsOf(hoopIds, posById, sizeById, PAD.kit));
  // A drum sub-zone hugs that drum's hoops.
  for (const d of drums) {
    const ids = leafNodes.filter((n) => n.data.stage === 'hoop' && n.id.startsWith(`hoop:${d.id}:`)).map((n) => n.id);
    push(drumZoneId(d.id), 'drum', d.label, true, boundsOf(ids, posById, sizeById, PAD.sub));
  }

  return zones;
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
