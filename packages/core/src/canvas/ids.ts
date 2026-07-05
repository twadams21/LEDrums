/**
 * Canvas-effect id convention — how a canvas SCENE document is addressed through the
 * ONE `EffectGenerator` seam. A `playType:'canvas'` play node names a scene; the voice
 * hosts `generatorId = canvasEffectId(sceneId)` and the effects registry resolves that
 * id to the scene's generator ADAPTER (see `canvas/scene.ts`) — the compositor and the
 * generator bridge never learn the difference (no second dispatch path, locked dec 7).
 */
export const CANVAS_EFFECT_PREFIX = 'canvas:';

/** The generator id a scene document is hosted under. */
export function canvasEffectId(sceneId: string): string {
  return CANVAS_EFFECT_PREFIX + sceneId;
}

export function isCanvasEffectId(id: string): boolean {
  return id.startsWith(CANVAS_EFFECT_PREFIX);
}

/** The scene id inside a canvas effect id, or `null` for a non-canvas id. */
export function canvasSceneIdOf(effectId: string): string | null {
  return isCanvasEffectId(effectId) ? effectId.slice(CANVAS_EFFECT_PREFIX.length) : null;
}
