import { describe, expect, it } from 'vitest';
import { CANVAS_PARAM_SPEC } from './scene';
import { canvasVoiceDefaultPreset, canvasVoiceEffectDef } from './voice-definition';
import type { CanvasScene } from './types';

const scene: CanvasScene = { id: 'test', name: 'Test', sampler: { kind: 'cylinder' }, lenses: [], elements: [] };

describe('canvas voice definitions', () => {
  it('carries every canonical range/default/unit into modulatable voice specs', () => {
    const effect = canvasVoiceEffectDef(scene);
    expect(effect.params).toEqual(CANVAS_PARAM_SPEC.map(({ type, ...spec }) => ({ ...spec,
      kind: type, envable: true, min: spec.min, max: spec.max, step: spec.step, unit: spec.unit })));
    expect(canvasVoiceDefaultPreset(scene)).toEqual({ id: 'canvas:test:default', name: 'Default',
      effectId: 'canvas:test', params: Object.fromEntries(CANVAS_PARAM_SPEC.map((spec) => [spec.key, spec.default])) });
  });
  it('does not share mutable effect specs or preset params between restored shows', () => {
    const a = canvasVoiceEffectDef(scene), b = canvasVoiceEffectDef(scene);
    a.params[0]!.max = 100;
    expect(b.params[0]!.max).toBe(1);
    const preset = canvasVoiceDefaultPreset(scene); preset.params.brightness = 0;
    expect(canvasVoiceDefaultPreset(scene).params.brightness).toBe(1);
    expect(CANVAS_PARAM_SPEC[0]!.max).toBe(1);
  });
});
