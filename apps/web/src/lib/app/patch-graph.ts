/* Patch Graph ⇄ routing seam — the PURE bridge between the @xyflow node graph's
   OUTPUT half (hoop → dataline → output → controller) and the neutral `PatchRouting`
   compiled by `patch-routing.ts` (S2). No Svelte / DOM here so the wiring math is
   unit-testable; the view (`PatchGraphView.svelte`) is a thin consumer.

   Two directions:
   - `buildOutputHalf(routing)` derives the dataline + output flow nodes and the
     hoop→dataline / dataline→output / output→controller edges that DRAW a routing.
   - `routingFromGraph(nodes, edges)` reads the live graph back into a `PatchRouting`
     so a rewire can be recompiled (`patchToOutputs`) and pushed to the server.

   ORDER COMES FROM GEOMETRY. The flow graph is an unordered node/edge set, but pixel
   transmit order is "first hoop on the first dataline on the first output → …". We make
   that concrete with VERTICAL (y) position: outputs are ordered top→bottom, the
   datalines feeding an output are ordered top→bottom, and the hoops feeding a dataline
   are ordered top→bottom. Dragging a node up/down therefore reorders transmit order —
   the intuitive read of a left→right signal-flow graph.

   HOOP INDEX BASE. The topology's hoop NODE ids are 1-based (`hoop:<drum>:1..N`, see
   `patch-topology.ts`), while core's `OutputSegment` / S2 `HoopRef.hoop` are 0-based
   (`dmx-map.ts` validates `0..hoopCount-1`). The id helpers below bridge that seam so
   the two never leak into each other. */

import type { OutputConfig } from '@ledrums/core';
import {
  CONTROLLER_ID,
  NODE_H,
  NODE_W,
  STAGE_ORDER,
  hoopId,
  type PatchFlowEdge,
  type PatchFlowNode,
  type PatchStage,
} from './patch-topology';
import {
  DEFAULT_HOOPS_PER_DATALINE,
  outputsToPatch,
  patchToOutputs,
  type DataLine,
  type HoopRef,
  type PatchOutput,
  type PatchRouting,
} from './patch-routing';

// --- node-id grammar (kept decodable by patch-topology's describePatchNode) --------

const OUTPUT_PREFIX = 'output:';
const DATALINE_PREFIX = 'dataline:';

/** Flow-node id for a hoop ref (0-based core hoop → 1-based topology node). */
export function hoopNodeId(ref: HoopRef): string {
  return hoopId(ref.drumId, ref.hoop + 1);
}

/** Decode a hoop flow-node id back to a 0-based {@link HoopRef}; null if not a hoop.
    Drum ids never contain ':' today, but rejoin the middle defensively anyway. */
export function parseHoopNodeId(id: string): HoopRef | null {
  const parts = id.split(':');
  if (parts[0] !== 'hoop' || parts.length < 3) return null;
  const n = Number(parts[parts.length - 1]);
  if (!Number.isFinite(n)) return null;
  const drumId = parts.slice(1, -1).join(':');
  if (!drumId) return null;
  return { drumId, hoop: n - 1 };
}

/** Flow-node id for a physical output, carrying its `OutputConfig.id` for round-trip. */
export function outputNodeId(outputId: string): string {
  return OUTPUT_PREFIX + outputId;
}

/** Recover an output's `OutputConfig.id` from its flow-node id; null if not an output. */
export function parseOutputNodeId(id: string): string | null {
  return id.startsWith(OUTPUT_PREFIX) ? id.slice(OUTPUT_PREFIX.length) : null;
}

/** Flow-node id for a data line (an opaque per-graph key; identity is via edges, not id). */
export function dataLineNodeId(key: string): string {
  return DATALINE_PREFIX + key;
}

// --- layout helpers (mirror patch-topology's column maths, kept local & pure) -------

/** Signal-flow role colour for the two output-half stages we emit (matches the
    private STAGE_ROLE in patch-topology; only these two are minted here). */
const STAGE_ROLE: Record<'dataline' | 'output', string> = {
  dataline: 'var(--role-effect)',
  output: 'var(--role-output)',
};

/** Stack `count` rows centred on `centerY` with the given pitch (mirror of the
    topology's private `stackY`). */
function stackY(count: number, centerY: number, pitch: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < count; i++) ys.push(centerY + (i - (count - 1) / 2) * pitch);
  return ys;
}

function flowNode(
  id: string,
  stage: 'dataline' | 'output',
  label: string,
  sub: string,
  x: number,
  y: number,
): PatchFlowNode {
  return {
    id,
    type: 'patch',
    position: { x, y },
    initialWidth: NODE_W,
    initialHeight: NODE_H,
    data: { label, sub, stage, role: STAGE_ROLE[stage] },
  };
}

function flowEdge(source: string, target: string): PatchFlowEdge {
  return { id: `${source}->${target}`, source, target };
}

/** Layout + wiring context for {@link buildOutputHalf} — column x's and the vertical
    anchor (the input half supplies these; see the view). */
export interface OutputHalfLayout {
  /** Flow-space x for the dataline column. */
  colDataline: number;
  /** Flow-space x for the output column. */
  colOutput: number;
  /** Id of the (single) controller sink node, already present from the input half. */
  controllerId?: string;
  /** Vertical centre to stack the output half around. */
  midY: number;
  /** Vertical pitch between stacked data lines. */
  rowH?: number;
  /** Only emit a hoop→dataline edge when the hoop node actually exists in the graph. */
  hasHoop?: (hoopNodeId: string) => boolean;
}

/**
 * Derive the output-half flow nodes + edges that DRAW a `PatchRouting`. Returns the
 * dataline and output nodes (the controller is assumed already present from the input
 * half) plus the hoop→dataline, dataline→output and output→controller edges. Data lines
 * stack top→bottom in transmit order; each output sits at the mean y of its lines.
 */
export function buildOutputHalf(
  routing: PatchRouting,
  layout: OutputHalfLayout,
): { nodes: PatchFlowNode[]; edges: PatchFlowEdge[] } {
  const rowH = layout.rowH ?? 64;
  const controllerId = layout.controllerId ?? CONTROLLER_ID;
  const nodes: PatchFlowNode[] = [];
  const edges: PatchFlowEdge[] = [];

  // Flatten every data line across all outputs so they share one vertical column.
  const lines: Array<{ nodeId: string; ownerNodeId: string; hoops: HoopRef[] }> = [];
  const outputs: Array<{ nodeId: string; lineNodeIds: string[] }> = [];
  let lineCounter = 0;
  for (const output of routing.outputs) {
    const oNodeId = outputNodeId(output.id);
    const lineNodeIds: string[] = [];
    for (const dl of output.dataLines) {
      const nodeId = dataLineNodeId(String(++lineCounter));
      lines.push({ nodeId, ownerNodeId: oNodeId, hoops: dl.hoops });
      lineNodeIds.push(nodeId);
    }
    outputs.push({ nodeId: oNodeId, lineNodeIds });
  }

  const lineYs = stackY(lines.length, layout.midY, rowH);
  const yByLine = new Map<string, number>();
  lines.forEach((l, i) => yByLine.set(l.nodeId, lineYs[i]!));

  // dataline nodes + their incoming hoop edges
  lines.forEach((l, i) => {
    const y = lineYs[i]!;
    nodes.push(flowNode(l.nodeId, 'dataline', `Data Line ${i + 1}`, `${l.hoops.length} hoops`, layout.colDataline, y));
    for (const ref of l.hoops) {
      const hId = hoopNodeId(ref);
      if (layout.hasHoop && !layout.hasHoop(hId)) continue;
      edges.push(flowEdge(hId, l.nodeId));
    }
  });

  // output nodes (at the mean y of their lines) + dataline→output + output→controller
  outputs.forEach((o, oi) => {
    const ys = o.lineNodeIds.map((id) => yByLine.get(id)!);
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : layout.midY;
    nodes.push(flowNode(o.nodeId, 'output', `Output ${oi + 1}`, `port ${oi + 1}`, layout.colOutput, y));
    for (const lineNodeId of o.lineNodeIds) edges.push(flowEdge(lineNodeId, o.nodeId));
    edges.push(flowEdge(o.nodeId, controllerId));
  });

  return { nodes, edges };
}

// --- graph → routing (the rewire read-back) ----------------------------------------

/** Per-output transport scalars the graph does NOT author (channels + an optional
    universe snap) — supplied from the authoritative project so a rewire preserves them.
    `startUniverse` is optional: absent → the output packs dense/contiguous. */
export type OutputScalars = { startUniverse?: number; channelsPerPixel: number };

/** Sensible defaults for an output the project hasn't seen yet (a fresh palette node):
    3 channels/pixel, dense (no universe snap). */
export const DEFAULT_OUTPUT_SCALARS: OutputScalars = { channelsPerPixel: 3 };

/**
 * Read the live flow graph's output half back into a `PatchRouting`. Outputs, their
 * data lines, and each line's hoops are ordered by vertical (y) position — the visual
 * top→bottom order IS the transmit order. `getScalars` supplies the per-output
 * universe/channel settings the graph doesn't carry (keyed by `OutputConfig.id`);
 * `getLineUniverse` supplies a data line's optional `startUniverse` snap (keyed by its
 * owning output id + its index within that output, so a set boundary survives a rewire).
 *
 * Only stage-correct edges contribute: dataline→output for an output's lines,
 * hoop→dataline for a line's hoops. Stray / mis-staged wires are ignored, so a sloppy
 * drop can never corrupt the routing.
 */
export function routingFromGraph(
  nodes: ReadonlyArray<PatchFlowNode>,
  edges: ReadonlyArray<PatchFlowEdge>,
  getScalars: (outputId: string) => OutputScalars = () => DEFAULT_OUTPUT_SCALARS,
  getLineUniverse: (outputId: string, lineIndex: number) => number | undefined = () => undefined,
): PatchRouting {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stageOf = (id: string): PatchStage | undefined => byId.get(id)?.data.stage;
  const yOf = (id: string): number => byId.get(id)?.position.y ?? 0;
  const byY = (a: string, b: string): number => yOf(a) - yOf(b);

  /** Source node ids of a given stage feeding `targetId`, in top→bottom order. */
  const sourcesInto = (targetId: string, sourceStage: PatchStage): string[] =>
    edges
      .filter((e) => e.target === targetId && stageOf(e.source) === sourceStage)
      .map((e) => e.source)
      .sort(byY);

  const outputNodeIds = nodes
    .filter((n) => n.data.stage === 'output')
    .map((n) => n.id)
    .sort(byY);

  const outputs: PatchOutput[] = outputNodeIds.map((oNodeId) => {
    const id = parseOutputNodeId(oNodeId) ?? oNodeId;
    const dataLines: DataLine[] = sourcesInto(oNodeId, 'dataline').map((lineId, lineIndex) => {
      const hoops: HoopRef[] = [];
      for (const hId of sourcesInto(lineId, 'hoop')) {
        const ref = parseHoopNodeId(hId);
        if (ref) hoops.push(ref);
      }
      const startUniverse = getLineUniverse(id, lineIndex);
      return startUniverse === undefined ? { id: lineId, hoops } : { id: lineId, startUniverse, hoops };
    });
    const { startUniverse, channelsPerPixel } = getScalars(id);
    return startUniverse === undefined
      ? { id, channelsPerPixel, dataLines }
      : { id, startUniverse, channelsPerPixel, dataLines };
  });

  return { outputs };
}

// --- canonical signature (the cold-load adopt discriminator) ------------------------

/**
 * Canonical signature of an output-half routing, projected into core's `OutputConfig[]`
 * normal form (segment-coalesced, fixed key order) via {@link patchToOutputs}. A routing
 * DRAWN in the graph, the server's stored `kit.outputs`, and a freshly compiled rewire all
 * collapse to ONE string here — so the Patch view can tell the echo of the user's own edit
 * (signature unchanged) from a genuine external change (signature differs) when deciding
 * whether to re-adopt the project's outputs on a cold load. `patchToOutputs ∘ outputsToPatch`
 * is idempotent on a canonical `OutputConfig[]`, so the project's outputs and a live rewire
 * compare apples-to-apples.
 */
export function routingSignature(routing: PatchRouting): string {
  return JSON.stringify(patchToOutputs(routing));
}

/** {@link routingSignature} for a core `OutputConfig[]` (e.g. the project's `kit.outputs`). */
export function outputsSignature(outputs: OutputConfig[]): string {
  return routingSignature(outputsToPatch(outputs));
}

// --- fallback routing (when the project carries no authored outputs) ----------------

/** A drum the size of its hoop chain — all the fallback synth needs. */
export interface RoutingDrum {
  id: string;
  hoopCount: number;
}

/**
 * Synthesize a default `PatchRouting` from the kit when the project declares no
 * `outputs` (the common first-boot case — core derives a flat map, but the graph needs
 * something to draw + rewire). Walks the drum-ordered hoop chain (0-based hoops) and
 * chunks it into data lines of `hoopsPerDataLine`, one output per line — reproducing the
 * Patch view's prior visual default, now as a real routing that round-trips on the first
 * rewire. Output ids are stable ("1", "2", …) so they survive a remount.
 */
export function defaultRouting(
  drums: ReadonlyArray<RoutingDrum>,
  opts?: { hoopsPerDataLine?: number },
): PatchRouting {
  const size = Math.max(1, Math.floor(opts?.hoopsPerDataLine ?? DEFAULT_HOOPS_PER_DATALINE));
  const chain: HoopRef[] = [];
  for (const d of drums) {
    for (let h = 0; h < d.hoopCount; h++) chain.push({ drumId: d.id, hoop: h });
  }
  const outputs: PatchOutput[] = [];
  for (let i = 0, n = 0; i < chain.length; i += size, n++) {
    const hoops = chain.slice(i, i + size);
    const id = String(n + 1);
    // No startUniverse → the synthesized chain packs dense/contiguous from universe 0.
    outputs.push({ id, channelsPerPixel: 3, dataLines: [{ id: `${id}:dl0`, hoops }] });
  }
  return { outputs };
}

/** The full set of left→right stages, re-exported for the view's keep/drop partition. */
export { STAGE_ORDER };
