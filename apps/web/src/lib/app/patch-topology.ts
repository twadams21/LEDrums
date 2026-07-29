/* Patch Graph topology types + kit resolution — PURE, data-driven (no Svelte, no
   DOM). The flow-node/edge types and stage vocabulary for the patch graph, the
   kit → `TopologyDrum[]` resolution (`topoDrumsFromKit`), and `describePatchNode`,
   which decodes a stage-prefixed node id back into a human summary for the
   Inspector. Output shape is typed for `@xyflow/svelte`. */

import type { Edge, Node } from '@xyflow/svelte';
import { drumHoopCount, type KitConfig } from '@ledrums/core';
import { parsePatchNodeId } from './patch-node-id';

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
  /** Hoop nodes only: true when the hoop ends its run (no downstream hoop wired). A terminal
      hoop hides its source (output) handle — there's nothing further along the chain to feed. */
  terminal?: boolean;
};

export type PatchFlowNode = Node<PatchNodeData>;
export type PatchFlowEdge = Edge;

/** A drum as the topology needs it: identity + its physical zones + hoop count. */
export interface TopologyDrum {
  id: string;
  label: string;
  /** Ordered physical zones (Sensory Percussion sensor zones) for this drum. */
  zones: string[];
  /** Number of LED hoops on this drum (from the canonical kit). */
  hoopCount: number;
}

/** Fixed node-card size (matches PatchNode.svelte's `.pnode`). Seeded onto each
    node as initialWidth/Height so xyflow knows the dimensions at first render —
    nodes are gated to `visibility: hidden` until they "have dimensions", and the
    ResizeObserver writeback doesn't land on a $state.raw-bound array, so without
    this the whole graph stays invisible and `fitView` has no bounds to fit. */
export const NODE_W = 176;
export const NODE_H = 48;

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
  const ref = parsePatchNodeId(id);
  switch (ref.kind) {
    case 'input':
      return { stage: 'input', title: 'Sensory Percussion', sub: 'trigger input' };
    case 'controller':
      return { stage: 'controller', title: 'Controller', sub: 'Art-Net / sACN pixel controller' };
    // D1 holder zones (patch-graph v2 container nodes)
    case 'kit':
      return { stage: 'drum', title: 'Drum Kit', sub: 'kit globals' };
    case 'triggers':
      return { stage: 'trigger', title: 'Drum Triggers', sub: 'trigger inputs' };
    case 'trigger':
      return { stage: 'trigger', title: `${labelOf(ref.drumId)} Trigger`, sub: 'input → trigger' };
    case 'drum':
      return { stage: 'drum', title: `${labelOf(ref.drumId)} Drum`, sub: 'zones converge → hoops' };
    case 'hoop':
      return { stage: 'hoop', title: `${labelOf(ref.drumId)} Hoop ${ref.hoop}`, sub: 'LED hoop' };
    case 'output':
      return { stage: 'output', title: `Output ${ref.outputId}`, sub: 'physical data run' };
    case 'unknown':
      return { stage: 'input', title: id, sub: 'patch node' };
  }
}
