/* Patch Graph ⇄ routing seam — the PURE bridge between the @xyflow node graph's
   OUTPUT half and the neutral `PatchRouting` compiled by `patch-routing.ts` (S2).
   No Svelte / DOM here so the wiring math is unit-testable; the view
   (`PatchGraphView.svelte`) is a thin consumer.

   Two directions:
   - `buildOutputHalf(routing)` derives the Output flow nodes and the physical
     `Output → Hoop → Hoop …` chain edges that DRAW a routing.
   - `routingFromGraph(nodes, edges)` reads the live graph back into a `PatchRouting`
     so a rewire can be recompiled (`patchToOutputs`) and pushed to the server.

   ORDER COMES FROM THE WIRE CHAIN (D1). Each Output roots exactly one physical data
   run: `Output → Hoop → Hoop → …`. Pixel transmit order within a run is the order the
   chain is WALKED — not node y-position. Re-pointing a wire re-orders the run; dragging
   a node never does. (Outputs themselves carry independent universe/channel spaces, so
   their relative order only affects the Inspector's global pixel read-out; we keep a
   stable top→bottom output order for that, but a run's transmit order is purely its chain.)

   HOOP INDEX BASE. Hoop indices are **1-based everywhere** since A1: the topology's hoop
   NODE ids (`hoop:<drum>:1..N`, see `patch-topology.ts`), core's `OutputSegment`, and
   `HoopRef.hoop` all agree (`dmx-map.ts` validates `1..hoopCount`). The id helpers below
   just format/parse the shared 1-based number. */

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
  DEFAULT_HOOPS_PER_OUTPUT,
  outputsToPatch,
  patchToOutputs,
  type HoopRef,
  type PatchOutput,
  type PatchRouting,
} from './patch-routing';

// --- node-id grammar (kept decodable by patch-topology's describePatchNode) --------

const OUTPUT_PREFIX = 'output:';

/** Flow-node id for a hoop ref. Both `HoopRef.hoop` and the topology node id are 1-based (A1). */
export function hoopNodeId(ref: HoopRef): string {
  return hoopId(ref.drumId, ref.hoop);
}

/** Decode a hoop flow-node id back to a 1-based {@link HoopRef}; null if not a hoop.
    Drum ids never contain ':' today, but rejoin the middle defensively anyway. */
export function parseHoopNodeId(id: string): HoopRef | null {
  const parts = id.split(':');
  if (parts[0] !== 'hoop' || parts.length < 3) return null;
  const n = Number(parts[parts.length - 1]);
  if (!Number.isFinite(n)) return null;
  const drumId = parts.slice(1, -1).join(':');
  if (!drumId) return null;
  return { drumId, hoop: n };
}

/** Flow-node id for a physical output, carrying its `OutputConfig.id` for round-trip. */
export function outputNodeId(outputId: string): string {
  return OUTPUT_PREFIX + outputId;
}

/** Recover an output's `OutputConfig.id` from its flow-node id; null if not an output. */
export function parseOutputNodeId(id: string): string | null {
  return id.startsWith(OUTPUT_PREFIX) ? id.slice(OUTPUT_PREFIX.length) : null;
}

// --- layout helpers (mirror patch-topology's column maths, kept local & pure) -------

/** Signal-flow role colour for the Output stage (matches patch-topology's STAGE_ROLE). */
const OUTPUT_ROLE = 'var(--role-output)';

/** Stack `count` rows centred on `centerY` with the given pitch (mirror of the
    topology's private `stackY`). */
function stackY(count: number, centerY: number, pitch: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < count; i++) ys.push(centerY + (i - (count - 1) / 2) * pitch);
  return ys;
}

function outputFlowNode(id: string, label: string, sub: string, x: number, y: number): PatchFlowNode {
  return {
    id,
    type: 'patch',
    position: { x, y },
    initialWidth: NODE_W,
    initialHeight: NODE_H,
    data: { label, sub, stage: 'output', role: OUTPUT_ROLE },
  };
}

function flowEdge(source: string, target: string): PatchFlowEdge {
  return { id: `${source}->${target}`, source, target };
}

/** Layout + wiring context for {@link buildOutputHalf} — the output column x and the vertical
    anchor (the input half supplies these; see the view). */
export interface OutputHalfLayout {
  /** Flow-space x for the output column. */
  colOutput: number;
  /** Id of the (single) controller sink node, already present from the input half. */
  controllerId?: string;
  /** Vertical centre to stack the output half around. */
  midY: number;
  /** Vertical pitch between stacked outputs. */
  rowH?: number;
  /** Only emit a chain edge onto a hoop when the hoop node actually exists in the graph. */
  hasHoop?: (hoopNodeId: string) => boolean;
}

/**
 * Derive the output-half flow nodes + edges that DRAW a `PatchRouting`. Returns one Output
 * node per output plus the physical chain edges: `output → firstHoop`, each `hoop → nextHoop`
 * along the run, and `output → controller` (the sink is assumed already present from the input
 * half). Outputs stack top→bottom in transmit order. An output with no hoops still draws (an
 * inert node awaiting its first wire).
 */
export function buildOutputHalf(
  routing: PatchRouting,
  layout: OutputHalfLayout,
): { nodes: PatchFlowNode[]; edges: PatchFlowEdge[] } {
  const rowH = layout.rowH ?? 64;
  const controllerId = layout.controllerId ?? CONTROLLER_ID;
  const nodes: PatchFlowNode[] = [];
  const edges: PatchFlowEdge[] = [];
  const hasHoop = layout.hasHoop ?? (() => true);

  // Dedupe output ids: two outputs sharing an id would mint the same node id (and edge id)
  // twice → SvelteFlow's keyed each throws `each_key_duplicate` and the whole canvas dies. A
  // shape-valid-but-integrity-invalid routing (pasted / setProject-bypassed) can carry a
  // duplicate id, so keep the FIRST and skip the rest here rather than crash.
  const outputs: PatchOutput[] = [];
  const seenOutputIds = new Set<string>();
  for (const output of routing.outputs) {
    if (seenOutputIds.has(output.id)) continue;
    seenOutputIds.add(output.id);
    outputs.push(output);
  }

  const ys = stackY(outputs.length, layout.midY, rowH);
  outputs.forEach((output, oi) => {
    const oNodeId = outputNodeId(output.id);
    nodes.push(outputFlowNode(oNodeId, `Output ${oi + 1}`, `${output.hoops.length} hoops`, layout.colOutput, ys[oi]!));
    edges.push(flowEdge(oNodeId, controllerId));

    // Walk the run: output → firstHoop, then hoop → nextHoop. Dedupe so a corrupt routing
    // (the same hoop repeated) can't emit two edges with the identical id and crash the keyed
    // each; only emit an edge whose downstream hoop node exists in the graph.
    let prevNodeId = oNodeId;
    const seenHoops = new Set<string>();
    for (const ref of output.hoops) {
      const hId = hoopNodeId(ref);
      if (seenHoops.has(hId)) continue;
      seenHoops.add(hId);
      if (hasHoop(hId)) edges.push(flowEdge(prevNodeId, hId));
      prevNodeId = hId;
    }
  });

  return { nodes, edges };
}

/** True for edges that belong to the OUTPUT half's physical chain: an `output → hoop` root
    edge, an `output → controller` sink edge, or a `hoop → hoop` chain edge. The input half
    (input→trigger→zone→drum→hoop) + controller sink are authored once at mount; these chain
    edges are what a rewire re-derives. */
function isChainEdge(e: PatchFlowEdge, stageOf: (id: string) => PatchStage | undefined): boolean {
  const s = stageOf(e.source);
  if (s === 'output') return true; // output→hoop or output→controller
  return s === 'hoop' && stageOf(e.target) === 'hoop'; // hoop→hoop
}

/**
 * Re-derive ONLY the output half (Output nodes + their chain edges) from an authoritative
 * `routing`, splicing it back onto the CURRENT input half + controller sink. Drops every
 * existing Output node and every chain edge, then appends a freshly built output half — so a
 * half-applied local mutation (a partial rewire that threw mid-handler) is replaced wholesale.
 * The position of any surviving output node (same id) is preserved so a forced rebuild doesn't
 * fight a layout the user nudged.
 */
export function rebuildOutputHalf(
  routing: PatchRouting,
  current: { nodes: ReadonlyArray<PatchFlowNode>; edges: ReadonlyArray<PatchFlowEdge> },
  layout: OutputHalfLayout,
): { nodes: PatchFlowNode[]; edges: PatchFlowEdge[] } {
  const stageOf = (id: string): PatchStage | undefined =>
    current.nodes.find((n) => n.id === id)?.data.stage;
  const rebuilt = buildOutputHalf(routing, layout);
  const outHalfNodes = current.nodes.filter((n) => n.data.stage === 'output');
  const posById = new Map(outHalfNodes.map((n) => [n.id, n.position]));
  const outNodes = rebuilt.nodes.map((n) => {
    const prev = posById.get(n.id);
    return prev ? { ...n, position: prev } : n;
  });
  return {
    nodes: [...current.nodes.filter((n) => n.data.stage !== 'output'), ...outNodes],
    edges: [...current.edges.filter((e) => !isChainEdge(e, stageOf)), ...rebuilt.edges],
  };
}

// --- graph → routing (the rewire read-back) ----------------------------------------

/** Per-output transport scalars the graph does NOT author (channels + an optional universe
    snap + rgb order) — supplied from the authoritative project so a rewire preserves them.
    `startUniverse`/`rgbOrder` are optional: absent → the packer's dense/default behaviour. */
export type OutputScalars = { startUniverse?: number; channelsPerPixel: number; rgbOrder?: OutputConfig['rgbOrder'] };

/** Sensible defaults for an output the project hasn't seen yet (a fresh palette node):
    3 channels/pixel, dense (no universe snap), default rgb order. */
export const DEFAULT_OUTPUT_SCALARS: OutputScalars = { channelsPerPixel: 3 };

/**
 * Read the live flow graph's output half back into a `PatchRouting`. Each Output's hoop chain
 * is recovered by WALKING THE WIRE from the output node: `output → firstHoop` then each
 * `hoop → nextHoop`, in wire order — that walk IS the transmit order (not y-position). Outputs
 * themselves are ordered top→bottom for a stable, deterministic output list. `getScalars`
 * supplies the per-output universe/channel/rgb settings the graph doesn't carry (keyed by
 * `OutputConfig.id`).
 *
 * Only stage-correct edges contribute: `output → hoop` roots a run, `hoop → hoop` extends it.
 * Stray / mis-staged wires are ignored, so a sloppy drop can never corrupt the routing.
 */
export function routingFromGraph(
  nodes: ReadonlyArray<PatchFlowNode>,
  edges: ReadonlyArray<PatchFlowEdge>,
  getScalars: (outputId: string) => OutputScalars = () => DEFAULT_OUTPUT_SCALARS,
): PatchRouting {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stageOf = (id: string): PatchStage | undefined => byId.get(id)?.data.stage;
  const yOf = (id: string): number => byId.get(id)?.position.y ?? 0;
  const byY = (a: string, b: string): number => yOf(a) - yOf(b);

  /** The single downstream HOOP node id wired out of `sourceId` (an output or a hoop), or
      null. If more than one exists (a corrupt/fan-out graph), take the topmost for stability
      — the connect guard prevents this in practice. */
  const downstreamHoop = (sourceId: string): string | null => {
    const outs = edges
      .filter((e) => e.source === sourceId && stageOf(e.target) === 'hoop')
      .map((e) => e.target)
      .sort(byY);
    return outs[0] ?? null;
  };

  const outputNodeIds = nodes
    .filter((n) => n.data.stage === 'output')
    .map((n) => n.id)
    .sort(byY);

  const outputs: PatchOutput[] = outputNodeIds.map((oNodeId) => {
    const id = parseOutputNodeId(oNodeId) ?? oNodeId;
    const hoops: HoopRef[] = [];
    const seen = new Set<string>();
    let cursor = downstreamHoop(oNodeId);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const ref = parseHoopNodeId(cursor);
      if (ref) hoops.push(ref);
      cursor = downstreamHoop(cursor);
    }
    const { startUniverse, channelsPerPixel, rgbOrder } = getScalars(id);
    return {
      id,
      ...(startUniverse === undefined ? {} : { startUniverse }),
      channelsPerPixel,
      ...(rgbOrder === undefined ? {} : { rgbOrder }),
      hoops,
    };
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
 * something to draw + rewire). Walks the drum-ordered hoop chain (1-based hoops, A1) and
 * chunks it into outputs of `hoopsPerOutput` hoops each — reproducing the Patch view's prior
 * visual default, now as a real flat routing that round-trips on the first rewire. Output ids
 * are stable ("1", "2", …) so they survive a remount.
 */
export function defaultRouting(
  drums: ReadonlyArray<RoutingDrum>,
  opts?: { hoopsPerOutput?: number },
): PatchRouting {
  const size = Math.max(1, Math.floor(opts?.hoopsPerOutput ?? DEFAULT_HOOPS_PER_OUTPUT));
  const chain: HoopRef[] = [];
  for (const d of drums) {
    for (let h = 1; h <= d.hoopCount; h++) chain.push({ drumId: d.id, hoop: h }); // hoops 1-based (A1)
  }
  const outputs: PatchOutput[] = [];
  for (let i = 0, n = 0; i < chain.length; i += size, n++) {
    const hoops = chain.slice(i, i + size);
    const id = String(n + 1);
    // No startUniverse → the synthesized chain packs dense/contiguous from universe 0.
    outputs.push({ id, channelsPerPixel: 3, hoops });
  }
  return { outputs };
}

/** The full set of left→right stages, re-exported for the view's keep/drop partition. */
export { STAGE_ORDER };
