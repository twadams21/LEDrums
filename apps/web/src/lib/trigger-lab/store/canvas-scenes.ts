/**
 * Canvas scene authoring helpers (U5) — pure functions over authored `CanvasScene`
 * documents and the virtual `EffectDef`/`Preset` they project into the effect registry.
 *
 * A `playType:'canvas'` play node names a scene; the scene is hosted through the ONE
 * `EffectGenerator` seam as `canvas:<sceneId>` (see core `canvas/ids.ts`). This module
 * never touches the compositor — it only builds the authoring-layer shims (a virtual
 * effect + default preset per scene) so canvas nodes reuse the generic gallery/inspector
 * surfaces, plus the graph-retarget + JSON (de)serialization used by scene CRUD.
 */
import {
  CANVAS_PARAM_SPEC,
  canvasEffectId,
  canvasSceneIdOf,
  collectionMeta,
  type CanvasScene,
  type PlayType,
} from '@ledrums/core';
import { mapParamSpec } from '../fixtures';
import { defaultParams, type EffectDef, type GraphNode, type Preset, type TriggerGraph } from '../sim';

/** The bus canvas nodes default onto (the always-on base layer). */
export const CANVAS_BUS_ID = 'base';

/** A fresh authored scene — one drifting stripe field, ready to tweak in the JSON editor. */
export function makeCanvasScene(id: string, name = 'New canvas scene'): CanvasScene {
  return {
    id,
    name,
    description: 'Authored canvas scene sampled through the drum kit.',
    tags: ['canvas'],
    sampler: { kind: 'cylinder' },
    lenses: [],
    elements: [
      { kind: 'stripes', angleDeg: 0, widthU: 0.18, duty: 0.5, speedUps: 0.25, hue: 140, sat: 1, softness: 0.08 },
    ],
  };
}

/** The virtual `EffectDef` a scene is hosted under — `id`/`generatorId` = `canvas:<sceneId>`. */
export function canvasEffectDef(scene: CanvasScene): EffectDef {
  const id = canvasEffectId(scene.id);
  return {
    id,
    name: scene.name,
    generatorId: id,
    category: 'texture',
    description: scene.description,
    tags: ['canvas', ...(scene.tags ?? []).filter((tag) => tag !== 'canvas')] as EffectDef['tags'],
    playType: 'canvas',
    busId: CANVAS_BUS_ID,
    scope: 'kit',
    params: CANVAS_PARAM_SPEC.map(mapParamSpec),
    attackMs: 800,
    sustainMs: 0,
    releaseMs: 900,
  };
}

/** The default preset for a scene's virtual effect (all params at their spec defaults). */
export function canvasDefaultPreset(scene: CanvasScene): Preset {
  const eff = canvasEffectDef(scene);
  return { id: `${eff.id}:default`, name: 'Default', effectId: eff.id, params: defaultParams(eff) };
}

/** Scene ids referenced by any canvas play node in a graph. */
export function sceneRefsInGraph(graph: TriggerGraph): string[] {
  const out = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'play' && node.kind !== 'effect') continue;
    const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId) ?? undefined;
    if (sceneId) out.add(sceneId);
  }
  return [...out];
}

/**
 * Repoint every canvas play node that referenced `oldSceneId` onto `fallback` (or clear
 * the node's canvas binding when there is no fallback). Used when a scene is deleted so no
 * node is left dangling on an unregistered `canvas:<id>`.
 */
export function retargetSceneRefs(
  graphs: Record<string, TriggerGraph>,
  oldSceneId: string,
  fallback: CanvasScene | null,
): Record<string, TriggerGraph> {
  const fallbackEffect = fallback ? canvasEffectDef(fallback) : null;
  const fallbackPreset = fallback ? canvasDefaultPreset(fallback) : null;
  const out: Record<string, TriggerGraph> = {};

  for (const [key, graph] of Object.entries(graphs)) {
    let changed = false;
    const nodes = graph.nodes.map((node) => {
      if (node.kind !== 'play' && node.kind !== 'effect') return node;
      const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId) ?? undefined;
      if (sceneId !== oldSceneId) return node;
      changed = true;
      if (!fallback || !fallbackEffect || !fallbackPreset) {
        return { ...node, effectId: '', presetId: '', canvasScene: undefined, params: {}, playType: 'canvas' as PlayType };
      }
      return {
        ...node,
        playType: 'canvas' as PlayType,
        canvasScene: fallback.id,
        effectId: fallbackEffect.id,
        presetId: fallbackPreset.id,
        params: { ...fallbackPreset.params },
      };
    });
    out[key] = changed ? { ...graph, nodes } : graph;
  }
  return out;
}

/** Pretty-print a scene for the Objects-view JSON editor. */
export function formatCanvasScene(scene: CanvasScene): string {
  return JSON.stringify(scene, null, 2);
}

export type SceneJsonResult = { ok: true; scene: CanvasScene } | { ok: false; message: string };

/**
 * Parse + validate edited scene JSON. The scene id is STABLE (duplicate to fork a new id),
 * so an id change is rejected rather than silently reassigned. Structural minimum: name,
 * elements[], sampler{}.
 */
export function parseCanvasSceneJson(id: string, text: string): SceneJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Invalid JSON.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Scene JSON must be an object.' };
  const scene = raw as Partial<CanvasScene>;
  if (scene.id !== id) return { ok: false, message: 'Scene id is stable; duplicate the scene instead of editing its id.' };
  if (typeof scene.name !== 'string' || !scene.name.trim()) return { ok: false, message: 'Scene name is required.' };
  if (!Array.isArray(scene.elements)) return { ok: false, message: 'Scene elements must be an array.' };
  if (!scene.sampler || typeof scene.sampler !== 'object') return { ok: false, message: 'Scene sampler is required.' };
  return { ok: true, scene: scene as CanvasScene };
}

/** The gallery/palette label for a play type. */
export function collectionLabel(type: PlayType): string {
  return collectionMeta(type).label;
}
