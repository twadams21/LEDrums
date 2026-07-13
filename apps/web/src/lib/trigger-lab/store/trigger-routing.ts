/* Authoritative-Project updaters (Patch graph: routing / geometry / IO) — PURE immutable
   transforms of a {@link Project} (no runes/DOM). The store's mutators optimistic-write the
   result onto its local `project` rune AND forward the edit over WS; this module owns only the
   "compute the next Project" half. Each preserves the caller's passed-in refs (outputs /
   inputMap) so an identity-checking consumer still sees the same object. Extracted from
   store.svelte.ts unchanged in behaviour. */

import type { InputMap, NodeLayout, OutputConfig, Project } from '@ledrums/core';

/** Partial drum transform — origin/rotation/spin/start-angle/literal pixel geometry. */
export interface DrumTransformPartial {
  origin?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  localSpinDeg?: number;
  startAngleDeg?: number;
  pixelsPerHoop?: number;
  hoopSpacingMm?: number;
  diameterIn?: number;
  /** Physically flip the drum (geometry-only reflection; DMX bytes unchanged). */
  flip?: boolean;
}

/** Partial kit-global geometry change (S11): mirror is kit-wide, not per-drum. */
export interface KitGlobalPartial {
  /** Kit-wide mirror mode (geometry-only world reflection; DMX bytes unchanged). */
  mirror?: 'none' | 'x' | 'y';
}

/** Partial output-settings change (controller node: protocol/host/rgb/fps/transport fields). */
export interface OutputPartial {
  state?: Project['output']['state'];
  protocol?: Project['output']['protocol'];
  host?: string;
  rgbOrder?: Project['output']['rgbOrder'];
  fps?: number;
  broadcast?: boolean;
  priority?: number;
  port?: number;
  iface?: string;
}

/** Apply a drum's transform partial onto the project's kit (immutable). */
export function applyDrumTransform(project: Project, drumId: string, partial: DrumTransformPartial): Project {
  return {
    ...project,
    kit: { ...project.kit, drums: project.kit.drums.map((d) => (d.id === drumId ? { ...d, ...partial } : d)) },
  };
}

/** Kit-global geometry change (S11 mirror): merge onto project.kit.global (immutable). */
export function applyKitGlobal(project: Project, partial: KitGlobalPartial): Project {
  return { ...project, kit: { ...project.kit, global: { ...project.kit.global, ...partial } } };
}

/** Replace the physical-output topology (a Patch rewire → PixLite patch order). Keeps the
    passed `outputs` ref. */
export function applyRouting(project: Project, outputs: OutputConfig[]): Project {
  return { ...project, kit: { ...project.kit, outputs } };
}

/** Replace the input map (zone-node MIDI note / OSC address routing). Keeps the `inputMap` ref. */
export function applyInputMap(project: Project, inputMap: InputMap): Project {
  return { ...project, inputMap };
}

/** Replace the patch-graph canvas layout (D1: `kit.nodeLayout`, a manual per-node arrangement).
    Keeps the passed `nodeLayout` ref; a geometry-only field — no DMX / render impact. */
export function applyNodeLayout(project: Project, nodeLayout: NodeLayout): Project {
  return { ...project, kit: { ...project.kit, nodeLayout } };
}

/** Merge a partial output-settings change. */
export function applyOutput(project: Project, partial: OutputPartial): Project {
  return { ...project, output: { ...project.output, ...partial } };
}

/** Set or clear a Patch node's display-label override (the Inspector's rename field). A blank
    label clears the override (back to the derived title). Returns a new labels map. */
export function setPatchLabel(
  labels: Record<string, string>,
  nodeId: string,
  label: string,
): Record<string, string> {
  const trimmed = label.trim();
  const next = { ...labels };
  if (trimmed) next[nodeId] = trimmed;
  else delete next[nodeId];
  return next;
}
