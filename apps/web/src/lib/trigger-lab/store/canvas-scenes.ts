/**
 * Canvas scene authoring helpers (U5) — pure functions over authored `CanvasScene` documents: a
 * fresh scene, and the JSON (de)serialization the Objects view's scene editor uses. A Scene
 * Generator plays a scene by id; the scene is hosted through the ONE `EffectGenerator` seam as
 * `canvas:<sceneId>` (see core `canvas/ids.ts`).
 */
import type { CanvasScene } from '@ledrums/core';

/** A fresh authored scene — one drifting stripe field, ready to tweak in the JSON editor. */
export function makeCanvasScene(id: string, name = 'New canvas scene'): CanvasScene {
  return {
    id,
    name,
    description: 'Canvas scene for the drum kit',
    tags: ['canvas'],
    sampler: { kind: 'cylinder' },
    lenses: [],
    elements: [
      { kind: 'stripes', angleDeg: 0, widthU: 0.18, duty: 0.5, speedUps: 0.25, hue: 140, sat: 1, softness: 0.08 },
    ],
  };
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
