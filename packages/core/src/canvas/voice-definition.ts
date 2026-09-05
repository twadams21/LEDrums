import { mapVoiceParamSpec } from '../effects/voice-param-spec';
import type { EffectDef, Preset } from '../voice/types';
import { canvasEffectId } from './ids';
import { CANVAS_PARAM_SPEC } from './scene';
import type { CanvasScene } from './types';

export const CANVAS_BUS_ID = 'base';

/** Shared runtime definition for restored server shows and browser-authored canvas cards. */
export function canvasVoiceEffectDef(scene: CanvasScene): EffectDef {
  const id = canvasEffectId(scene.id);
  return {
    id, name: scene.name, generatorId: id, busId: CANVAS_BUS_ID, scope: 'kit',
    params: CANVAS_PARAM_SPEC.map(mapVoiceParamSpec), attackMs: 800, sustainMs: 0, releaseMs: 900,
  };
}

export function canvasVoiceDefaultPreset(scene: CanvasScene): Preset {
  const effect = canvasVoiceEffectDef(scene);
  return { id: `${effect.id}:default`, name: 'Default', effectId: effect.id,
    params: Object.fromEntries(effect.params.map((param) => [param.key, param.default])) };
}
