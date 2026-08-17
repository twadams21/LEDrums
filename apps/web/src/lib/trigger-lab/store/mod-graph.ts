/* Modulation-graph layer (doc 10, S34) — the target-param discovery + mod-input exposure +
   incoming-mapping queries behind the store's `modTargetSpecs` / `availableModParams` /
   `addModInput` / `removeModInput` / `mappingsFor` / `modSourcesFor`, as PURE transforms
   (no runes/DOM) over graph nodes/edges + resolved defs. The store's methods stay thin
   delegators (resolving the rune-backed `effectOf` before calling, keeping the `isViewer`
   guard + undo snapshot). Extracted from store.svelte.ts unchanged in behaviour. */

import type { EffectDef, GraphEdge, GraphNode } from '../sim';
import { voice } from '@ledrums/core';
import { nodeParamSpecs } from './face-params';

/** A numeric modulation-target row: the param key/label plus its optional range. */
export interface ModTargetSpec {
  key: string;
  label: string;
  min?: number;
  max?: number;
}

/** The numeric params a target node can expose as modulation targets — the declared params
    (normalized across both spec dialects by `nodeParamSpecs`) filtered to numbers, because
    only a number can be driven by a modulation source. Play/effect nodes read the resolved
    `effect` (the store resolves it — it is rune-backed); modifier nodes resolve from the
    core modifier registry. */
export function modTargetSpecs(node: GraphNode, effect: EffectDef | undefined): ModTargetSpec[] {
  return nodeParamSpecs(node, effect)
    .filter((s) => s.kind === 'number')
    .map((s) => ({ key: s.key, label: s.label, min: s.min, max: s.max }));
}

/** The ordered exposed modulation-target rows on a node. */
export function modInputsOf(node: GraphNode): { param: string }[] {
  return node.modInputs ?? [];
}

/** Numeric params not yet exposed — the "Add parameter" picker options. Composes
    {@link modTargetSpecs}, so the store passes the same resolved `effect`. */
export function availableModParams(node: GraphNode, effect: EffectDef | undefined): { key: string; label: string }[] {
  const exposed = new Set((node.modInputs ?? []).map((m) => m.param));
  return modTargetSpecs(node, effect)
    .filter((s) => !exposed.has(s.key))
    .map((s) => ({ key: s.key, label: s.label }));
}

/** The param a modulation wire dropped on this node's BODY should land on: its first exposed
    NUMBER row, else the first number param it could expose. Non-numeric face rows are skipped
    — since S5 a face row may be an enum or a bool, and those carry no `param:<key>` handle,
    so a drop that chose one would target a port nothing can evaluate. Undefined when the node
    declares no number param at all. */
export function modDropTargetParam(node: GraphNode, effect: EffectDef | undefined): string | undefined {
  const targets = modTargetSpecs(node, effect);
  if (targets.length === 0) return undefined;
  const keys = new Set(targets.map((s) => s.key));
  const exposed = (node.modInputs ?? []).find((m) => keys.has(m.param));
  return exposed ? exposed.param : targets[0]!.key;
}

/** Expose a param as a modulation target (append a node-face row). Returns the new modInputs
    array, or `null` when the param is already exposed (idempotent — caller skips undo/assign). */
export function addModInput(modInputs: { param: string }[] | undefined, param: string): { param: string }[] | null {
  const cur = modInputs ?? [];
  if (cur.some((m) => m.param === param)) return null;
  return [...cur, { param }];
}

/** Un-expose a param — drop its row. Returns a new modInputs array. */
export function removeModInput(modInputs: { param: string }[] | undefined, param: string): { param: string }[] {
  return (modInputs ?? []).filter((m) => m.param !== param);
}

/** Drop every incoming modulation wire targeting a node's exposed param. Returns a new edges
    array (paired with {@link removeModInput} on un-expose). */
export function edgesWithoutParamWires(edges: readonly GraphEdge[], nodeId: string, param: string): GraphEdge[] {
  return edges.filter((e) => !(e.to === nodeId && e.toPort === `param:${param}`));
}

/** The incoming mapping edges for a node's exposed param — one per wire, each editable. */
export function mappingsFor(edges: readonly GraphEdge[], nodeId: string, param: string): GraphEdge[] {
  return edges.filter((e) => e.to === nodeId && e.toPort === `param:${param}`);
}

/** The resolved modulation SOURCES wired into an exposed param row, each with its edge's
    `invert`. Dangling / non-source wires are skipped (never thrown), mirroring
    `resolveNodeModulations`. */
export function modSourcesFor(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  nodeId: string,
  param: string,
): { source: voice.ModSource; invert: boolean }[] {
  const out: { source: voice.ModSource; invert: boolean }[] = [];
  for (const e of edges) {
    if (e.to !== nodeId || e.toPort !== `param:${param}`) continue;
    const src = nodes.find((n) => n.id === e.from);
    if (!src) continue;
    const source = voice.nodeModSource(src);
    if (!source) continue;
    out.push({ source, invert: e.invert === true });
  }
  return out;
}
