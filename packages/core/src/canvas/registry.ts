/**
 * Canvas scene registry — scene documents registered here resolve through the effects
 * registry's `tryGetEffect('canvas:<sceneId>')`, so a canvas voice flows through the
 * EXISTING generator bridge + compositor untouched (locked decision 7). The core seed
 * library (U6) registers at module load; user-authored scenes from the show document
 * register at show hydrate (U5). Adapters are memoized per scene registration.
 */
import type { EffectGenerator } from '../effects/types';
import { canvasSceneIdOf } from './ids';
import { createCanvasSceneEffect, type CanvasSceneState } from './scene';
import type { CanvasScene } from './types';

const scenes = new Map<string, CanvasScene>();
const adapters = new Map<string, EffectGenerator<CanvasSceneState>>();

/** Register (or replace) a scene document. Replacing drops the memoized adapter so the
    next resolve sees the new content. */
export function registerCanvasScene(scene: CanvasScene): void {
  scenes.set(scene.id, scene);
  adapters.delete(scene.id);
}

/** Remove a scene (user-authored scene deleted from the show). */
export function unregisterCanvasScene(sceneId: string): void {
  scenes.delete(sceneId);
  adapters.delete(sceneId);
}

export function tryGetCanvasScene(sceneId: string): CanvasScene | undefined {
  return scenes.get(sceneId);
}

export function listCanvasScenes(): CanvasScene[] {
  return [...scenes.values()];
}

/** Resolve a `canvas:<sceneId>` effect id to its (memoized) scene adapter, or
    `undefined` for a non-canvas id / unregistered scene — the effects registry's
    fallback, giving the bridge one uniform lookup for hosted AND canvas voices. */
export function tryGetCanvasEffect(effectId: string): EffectGenerator<CanvasSceneState> | undefined {
  const sceneId = canvasSceneIdOf(effectId);
  if (sceneId == null) return undefined;
  const scene = scenes.get(sceneId);
  if (!scene) return undefined;
  let adapter = adapters.get(sceneId);
  if (!adapter) {
    adapter = createCanvasSceneEffect(scene);
    adapters.set(sceneId, adapter);
  }
  return adapter;
}
