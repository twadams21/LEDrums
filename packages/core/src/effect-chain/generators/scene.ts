import { canvasEffectId } from '../../canvas/ids';
import { BUILTIN_CANVAS_SCENES } from '../../canvas/presets';
import { tryGetCanvasScene } from '../../canvas/registry';
import type { GeneratorDevice } from '../types';
import type { GeneratorDef, ResolvedGenerator } from './types';

/** The device param holding the canvas-scene document id the Scene generator plays. */
const SCENE_PARAM = 'sceneId';
/** The scene played when the device names none: the first built-in canvas scene. */
const DEFAULT_SCENE_ID = BUILTIN_CANVAS_SCENES[0]!.id;
const STYLE_ID = 'scene';

/**
 * Resolve a Scene device to `canvas:<sceneId>`. Its one Style is a scene picker: the `sceneId`
 * param names a registered canvas scene (built-in or user-authored), defaulting to the first
 * built-in. The picker param is consumed here; every other param reaches the scene adapter.
 * An unknown Style or an unregistered scene resolves to `null`.
 */
function resolveScene(device: GeneratorDevice): ResolvedGenerator | null {
  if (device.style && device.style !== STYLE_ID) return null;
  const { [SCENE_PARAM]: picked, ...params } = device.params;
  const sceneId = typeof picked === 'string' && picked ? picked : DEFAULT_SCENE_ID;
  if (!tryGetCanvasScene(sceneId)) return null;
  return { effectId: canvasEffectId(sceneId), params, canvasScene: sceneId };
}

/**
 * Scene Generator — plays an authored canvas-scene document. The Style's `effectId` is the
 * default scene, so the card's params are the standard scene params every scene shares; the
 * picker's options come from the canvas scene registry (`listCanvasScenes`).
 */
export const sceneGenerator: GeneratorDef = {
  id: 'scene',
  label: 'Scene',
  description: 'Plays an authored canvas scene across the kit.',
  icon: 'image',
  styles: [{ id: STYLE_ID, label: 'Scene', effectId: canvasEffectId(DEFAULT_SCENE_ID) }],
  resolve: resolveScene,
};
