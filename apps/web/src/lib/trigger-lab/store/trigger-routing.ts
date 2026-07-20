/* Authoritative-Project updaters (Patch graph: routing / geometry / IO) — PURE immutable
   transforms of a {@link Project} (no runes/DOM). The store's mutators optimistic-write the
   result onto its local `project` rune AND forward the edit over WS; this module owns only the
   "compute the next Project" half. Each preserves the caller's passed-in refs (outputs /
   inputMap) so an identity-checking consumer still sees the same object. Extracted from
   store.svelte.ts unchanged in behaviour. */

import { materializeHoops, reconcileOutputs, type InputMap, type NodeLayout, type OutputConfig, type Project } from '@ledrums/core';

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
  /** Per-drum swatch (`DrumConfig.color`, hex) — the C3 drum-inspector Color control. */
  color?: string;
}

/** Partial kit-global change (S11 mirror + C1/C2 kit config): all kit-wide, not per-drum. */
export interface KitGlobalPartial {
  /** Kit-wide mirror mode (geometry-only world reflection; DMX bytes unchanged). */
  mirror?: 'none' | 'x' | 'y';
  /** Advatek expanded output mode (B2) — lives at kit.global.expanded. */
  expanded?: boolean;
  /** Global LED density (px/m). */
  ledDensityPxPerM?: number;
  /** Global hoops-per-drum count. */
  hoopCount?: number;
  /** Default vertical gap between hoops (mm). */
  defaultHoopSpacingMm?: number;
  /** Max pixels a single physical output may carry (Advatek PixLite). */
  maxPixelsPerOutput?: number;
}

/** Partial per-hoop edit (B4 first-class hoops[]) — pixel count and/or reverse flag. */
export interface HoopConfigPartial {
  /** Literal LED count for this hoop. */
  pixelCount?: number;
  /** Reverse the pixel index→position mapping within this hoop (wired-backwards strip). */
  reverse?: boolean;
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

/** Kit-global change (S11 mirror + C1/C2 config): merge onto project.kit.global (immutable). When
    `expanded` flips, reconcile kit.outputs to the new port count (4 normal / 8 expanded) so the
    optimistic local project matches what the server-apply backstop yields — mutation parity with
    Engine / VoiceEngineHost setKitGlobal. Reconcile is a no-op (same outputs ref) when the count is
    already right, so a plain mirror/density edit preserves the outputs identity as before. */
export function applyKitGlobal(project: Project, partial: KitGlobalPartial): Project {
  const merged: Project = { ...project, kit: { ...project.kit, global: { ...project.kit.global, ...partial } } };
  return partial.expanded !== undefined ? { ...merged, kit: reconcileOutputs(merged.kit) } : merged;
}

/** Per-hoop edit (B4): merge a partial onto `drum.hoops[hoopIndex-1]` (immutable). `hoopIndex`
    is 1-based (A1). SF1: a drum with no first-class `hoops[]` (a density-resolved drum, e.g. a
    fresh project from `DEFAULT_KIT`) is lazily MATERIALIZED via {@link materializeHoops} before the
    write — the resolved counts are byte-identical to what the renderer already built, so per-hoop
    editing works on ANY reachable drum shape without changing the pixel model. Idempotent for a
    drum that already carries `hoops[]`. Safe no-op when the drum is unknown or `hoopIndex` is out
    of range (not a valid write target) — no spurious materialization in that case. This mirrors the
    server backstop EXACTLY (`Engine.setHoopConfig` / `VoiceEngineHost.setHoopConfig`) via the same
    core helper (mutation parity). Preserves the drum/hoop refs it doesn't touch. */
export function applyHoopConfig(
  project: Project,
  drumId: string,
  hoopIndex: number,
  partial: HoopConfigPartial,
): Project {
  return {
    ...project,
    kit: {
      ...project.kit,
      drums: project.kit.drums.map((d) => {
        if (d.id !== drumId) return d;
        const hoops = d.hoops && d.hoops.length > 0 ? d.hoops : materializeHoops(project.kit, d);
        if (hoopIndex < 1 || hoopIndex > hoops.length) return d;
        return { ...d, hoops: hoops.map((h, i) => (i === hoopIndex - 1 ? { ...h, ...partial } : h)) };
      }),
    },
  };
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
    Values are each node's xyflow `position` — PARENT-RELATIVE for a child (leaf/drum sub-zone),
    absolute for a top holder zone (the parentId nesting frame). Keeps the passed `nodeLayout` ref;
    a geometry-only field — no DMX / render impact. */
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
