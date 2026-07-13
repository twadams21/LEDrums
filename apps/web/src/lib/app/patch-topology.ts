/* Patch Graph topology — the REAL input→device routing the rig is wired as, as a
   PURE, data-driven module (no Svelte, no DOM) so the wiring is unit-testable and
   the view stays thin. It turns the kit (drums + per-drum zones + hoop counts)
   into the left→right node graph the user patches:

     Sensory Percussion → Trigger(per drum) → Zone(per sensor zone) → Drum
        → Hoop(×hoopCount)     Output(port) → Hoop → Hoop …     → Controller

   The first four stages are the INPUT mapping (what a hit means); the Output nodes
   root the physical OUTPUT wiring — each Output is one data run that daisy-chains
   through hoops (`Output → Hoop → Hoop …`, D1: the intermediate Data Line is gone).
   The Drum node is the pivot the two halves share — every zone converges into it,
   every hoop fans out of it.

   Node ids are stage-prefixed strings (see the id helpers) so a selection can name
   any node without a lookup table, and `describePatchNode` decodes one back into a
   human summary for the Inspector. Output shape is typed for `@xyflow/svelte`. */

import type { Edge, Node } from '@xyflow/svelte';
import { drumHoopCount, type KitConfig } from '@ledrums/core';

/** The left→right stages of the device-routing topology (D1: no Data Line stage). */
export type PatchStage =
  | 'input'
  | 'trigger'
  | 'zone'
  | 'drum'
  | 'hoop'
  | 'output'
  | 'controller';

/** Payload carried on every flow node (xyflow `Node.data`). A type alias, not an
    interface, so it satisfies xyflow's `Record<string, unknown>` data constraint
    (object type-literals get an implicit index signature; interfaces do not). */
export type PatchNodeData = {
  /** Primary label, e.g. "Snare Trigger", "Tom 1 · edge", "Output 2". */
  label: string;
  /** Secondary mono line, e.g. "4 zones", "kick · snare", "port 1". */
  sub: string;
  stage: PatchStage;
  /** CSS custom-property reference for this stage's signal-flow role colour. */
  role: string;
};

export type PatchFlowNode = Node<PatchNodeData>;
export type PatchFlowEdge = Edge;

export interface PatchTopology {
  nodes: PatchFlowNode[];
  edges: PatchFlowEdge[];
}

/** A drum as the topology needs it: identity + its physical zones + hoop count. */
export interface TopologyDrum {
  id: string;
  label: string;
  /** Ordered physical zones (Sensory Percussion sensor zones) for this drum. */
  zones: string[];
  /** Number of LED hoops on this drum (from the canonical kit). */
  hoopCount: number;
}

export interface TopologyOptions {
  /** Max hoops carried on a single physical output run. The drum-ordered hoop chain
      is chunked by this capacity, which is what makes a drum's hoops split across
      runs and a run carry hoops from more than one drum (the real cross-wiring). */
  hoopsPerOutput?: number;
  /** Column stride (px) between stages. */
  colW?: number;
  /** Vertical pitch (px) between stacked nodes within a drum lane. */
  rowH?: number;
  /** Vertical gap (px) between adjacent drum lanes. */
  laneGap?: number;
}

/** Fixed node-card size (matches PatchNode.svelte's `.pnode`). Seeded onto each
    node as initialWidth/Height so xyflow knows the dimensions at first render —
    nodes are gated to `visibility: hidden` until they "have dimensions", and the
    ResizeObserver writeback doesn't land on a $state.raw-bound array, so without
    this the whole graph stays invisible and `fitView` has no bounds to fit. */
export const NODE_W = 176;
export const NODE_H = 48;

/** Left→right column order; a stage's index here is its column. */
export const STAGE_ORDER: readonly PatchStage[] = [
  'input',
  'trigger',
  'zone',
  'drum',
  'hoop',
  'output',
  'controller',
];

/** Signal-flow role colour per stage (design-system role tokens, icon + label). */
const STAGE_ROLE: Record<PatchStage, string> = {
  input: 'var(--role-input)',
  trigger: 'var(--role-input)',
  zone: 'var(--role-mod)',
  drum: 'var(--role-layer)',
  hoop: 'var(--role-content)',
  output: 'var(--role-output)',
  controller: 'var(--role-output)',
};

// --- node id grammar --------------------------------------------------------
// Every id is `<kind>` or `<kind>:<a>[:<b>]`, so describePatchNode can decode it.
export const INPUT_ID = 'input';
export const CONTROLLER_ID = 'controller';
export const triggerId = (drumId: string): string => `trigger:${drumId}`;
export const zoneNodeId = (drumId: string, zone: string): string => `zone:${drumId}:${zone}`;
export const drumNodeId = (drumId: string): string => `drum:${drumId}`;
export const hoopId = (drumId: string, hoop: number): string => `hoop:${drumId}:${hoop}`;
export const outputId = (index: number): string => `output:${index}`;

/** Stack `count` rows centred on `centerY` with the given pitch. */
function stackY(count: number, centerY: number, pitch: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < count; i++) ys.push(centerY + (i - (count - 1) / 2) * pitch);
  return ys;
}

/**
 * Build the full device-routing topology from the kit's drums. Pure: deterministic
 * column-based x/y placement (one vertical lane per drum) so ~50 nodes lay out
 * cleanly without a layout pass. The hoop→output chunking is the only "default"
 * — the true mapping lives in the server's DMX map (see the view's flag).
 */
export function buildPatchTopology(drums: TopologyDrum[], opts: TopologyOptions = {}): PatchTopology {
  const hoopsPerOutput = Math.max(1, opts.hoopsPerOutput ?? 6);
  const COL_W = opts.colW ?? 240;
  const ROW_H = opts.rowH ?? 72;
  const LANE_GAP = opts.laneGap ?? 40;
  const colX = (stage: PatchStage): number => STAGE_ORDER.indexOf(stage) * COL_W;

  const nodes: PatchFlowNode[] = [];
  const edges: PatchFlowEdge[] = [];
  const addNode = (id: string, stage: PatchStage, label: string, sub: string, x: number, y: number): void => {
    nodes.push({
      id,
      type: 'patch',
      position: { x, y },
      initialWidth: NODE_W,
      initialHeight: NODE_H,
      data: { label, sub, stage, role: STAGE_ROLE[stage] },
    });
  };
  const addEdge = (source: string, target: string): void => {
    edges.push({ id: `${source}->${target}`, source, target });
  };

  // Vertical lanes: one per drum, each sized to its densest column (zones | hoops).
  const laneH = drums.map((d) => Math.max(d.zones.length, d.hoopCount, 1) * ROW_H);
  const totalH = laneH.reduce((a, b) => a + b, 0) + LANE_GAP * Math.max(0, drums.length - 1);
  const midY = totalH / 2;
  const laneCenter: number[] = [];
  let cursor = 0;
  for (let i = 0; i < drums.length; i++) {
    laneCenter.push(cursor + laneH[i]! / 2);
    cursor += laneH[i]! + LANE_GAP;
  }

  // Far ends: the single input source and the single controller sink.
  addNode(INPUT_ID, 'input', 'Sensory Percussion', `${drums.length} triggers`, colX('input'), midY);
  addNode(CONTROLLER_ID, 'controller', 'Controller', 'Art-Net / sACN', colX('controller'), midY);

  // The drum-ordered hoop chain — the physical run we later chunk into data lines.
  const hoopChain: Array<{ id: string; drumLabel: string }> = [];

  for (let di = 0; di < drums.length; di++) {
    const d = drums[di]!;
    const cy = laneCenter[di]!;

    // input → trigger (one per drum)
    const tId = triggerId(d.id);
    addNode(tId, 'trigger', `${d.label} Trigger`, `${d.zones.length} zones`, colX('trigger'), cy);
    addEdge(INPUT_ID, tId);

    // the drum node — every zone converges into it, every hoop fans out of it
    const dId = drumNodeId(d.id);
    addNode(dId, 'drum', `${d.label} Drum`, `${d.hoopCount} hoops`, colX('drum'), cy);

    // trigger → zone → drum
    const zoneYs = stackY(d.zones.length, cy, ROW_H);
    d.zones.forEach((zone, zi) => {
      const zId = zoneNodeId(d.id, zone);
      addNode(zId, 'zone', `${d.label} · ${zone}`, 'sensor zone', colX('zone'), zoneYs[zi]!);
      addEdge(tId, zId);
      addEdge(zId, dId);
    });

    // drum → hoop (×hoopCount)
    const hoopYs = stackY(d.hoopCount, cy, ROW_H);
    for (let h = 1; h <= d.hoopCount; h++) {
      const hId = hoopId(d.id, h);
      addNode(hId, 'hoop', `${d.label} Hoop ${h}`, 'LED hoop', colX('hoop'), hoopYs[h - 1]!);
      addEdge(dId, hId);
      hoopChain.push({ id: hId, drumLabel: d.label });
    }
  }

  // Output → Hoop → Hoop … → Controller. Each Output roots one physical data run: the
  // drum-ordered hoop chain is chunked by capacity (the cross-wiring), and the output
  // daisy-chains its chunk's hoops in order (`output → firstHoop`, then `hoop → nextHoop`).
  // Every output terminates at the single controller sink.
  const runCount = Math.max(1, Math.ceil(hoopChain.length / hoopsPerOutput));
  const runYs = stackY(runCount, midY, ROW_H * 1.6);
  for (let ri = 0; ri < runCount; ri++) {
    const slice = hoopChain.slice(ri * hoopsPerOutput, (ri + 1) * hoopsPerOutput);
    if (slice.length === 0) continue;
    const index = ri + 1;
    const y = runYs[ri]!;

    const oId = outputId(index);
    const drumsOnRun = [...new Set(slice.map((h) => h.drumLabel))];
    addNode(oId, 'output', `Output ${index}`, drumsOnRun.join(' · '), colX('output'), y);
    addEdge(oId, CONTROLLER_ID);

    // daisy-chain: output → first hoop, then hoop → next hoop along the run
    let prev = oId;
    for (const h of slice) {
      addEdge(prev, h.id);
      prev = h.id;
    }
  }

  return { nodes, edges };
}

/**
 * Resolve the input half's `TopologyDrum[]` from a kit + the lab's drum list. The hoop
 * count for each drum derives from the SUPPLIED kit (per-drum override or the kit global)
 * — so a non-default project kit renders the right number of hoop nodes upstream, the same
 * way the OUTPUT half is already project-authoritative (#11; the old view read hoop counts
 * from `DEFAULT_KIT`). `zonesForDrum` stays a view concern (it unions a drum's physical +
 * authored sensor zones), so it is injected rather than derived here.
 */
export function topoDrumsFromKit(
  kit: KitConfig,
  drums: ReadonlyArray<{ id: string; label: string }>,
  zonesForDrum: (drumId: string) => string[],
): TopologyDrum[] {
  return drums.map((d) => {
    const kitDrum = kit.drums.find((k) => k.id === d.id);
    const hoopCount = kitDrum ? drumHoopCount(kit, kitDrum) : kit.global.hoopCount;
    return { id: d.id, label: d.label, zones: zonesForDrum(d.id), hoopCount };
  });
}

/** A human-readable summary of a patch node id, for the Inspector (no built graph
    needed). `drums` resolves drum ids to labels; falls back to the raw id. */
export interface PatchNodeDescription {
  stage: PatchStage;
  title: string;
  sub: string;
}

export function describePatchNode(
  id: string,
  drums: ReadonlyArray<{ id: string; label: string }> = [],
): PatchNodeDescription {
  const labelOf = (drumId: string): string => drums.find((d) => d.id === drumId)?.label ?? drumId;
  if (id === INPUT_ID) return { stage: 'input', title: 'Sensory Percussion', sub: 'trigger input' };
  if (id === CONTROLLER_ID) return { stage: 'controller', title: 'Controller', sub: 'Art-Net / sACN pixel controller' };

  const [kind, a, b] = id.split(':');
  switch (kind) {
    case 'trigger':
      return { stage: 'trigger', title: `${labelOf(a ?? '')} Trigger`, sub: 'input → trigger' };
    case 'zone':
      return { stage: 'zone', title: `${labelOf(a ?? '')} · ${b ?? ''}`, sub: 'sensor zone' };
    case 'drum':
      return { stage: 'drum', title: `${labelOf(a ?? '')} Drum`, sub: 'zones converge → hoops' };
    case 'hoop':
      return { stage: 'hoop', title: `${labelOf(a ?? '')} Hoop ${b ?? ''}`, sub: 'LED hoop' };
    case 'output':
      return { stage: 'output', title: `Output ${a ?? ''}`, sub: 'physical data run' };
    default:
      return { stage: 'input', title: id, sub: 'patch node' };
  }
}
