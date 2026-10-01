/* Effect chains S03 (wave-2 piece gen-field) — the Noise, Particles and Pattern Generators.
   Oracle: each hosted effect implementation rendered directly at its own defaults. */
import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../../engine/framebuffer';
import type { RenderContext, Trigger } from '../../engine/render-context';
import { tryGetEffect, getEffect } from '../../effects/registry';
import { defaultParams, type EffectGenerator, type ResolvedParams } from '../../effects/types';
import { parseKit } from '../../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../../geometry/pixel-model';
import { effectPlayAction } from '../resolver';
import { chainEffectDefId } from '../runtime';
import { parseEffect, type GeneratorDevice, type GeneratorKind } from '../types';
import { generatorParamSpec, getGeneratorDef, listGenerators, resolveGenerator } from './index';

/** The spec's Style mapping for this piece: kind → every hosted effect id, exactly once. */
const MAPPING: Record<'noise' | 'particles' | 'pattern', readonly string[]> = {
  noise: ['plasma', 'perlin-clouds', 'lava-lamp', 'caustics', 'fire', 'flame-flicker', 'velocity-flames'],
  particles: [
    'confetti-burst', 'sparkler', 'starfield', 'rain-3d', 'gravity-drops', 'gravity-wells',
    'collisions', 'pixel-accum', 'sacred-hogs',
  ],
  pattern: ['segments', 'checker-pulse', 'grid-glow'],
};
const KINDS = Object.keys(MAPPING) as (keyof typeof MAPPING)[];

const device = (kind: GeneratorKind, style: string, params: GeneratorDevice['params'] = {}): GeneratorDevice =>
  ({ kind, style, params });

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: ['kick', 'snare'].map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

function ctxAt(m: PixelModel, timeMs: number, triggers: Trigger[]): RenderContext {
  const beat = timeMs / 500;
  return {
    model: m, timeMs, dt: 20, triggers,
    transport: { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true },
  };
}

/** Render `frames` 20 ms frames (two hits early on, so trigger-reactive Styles light), returning every frame. */
function renderSequence(effect: EffectGenerator<unknown>, params: ResolvedParams, m: PixelModel, frames = 12): Float32Array[] {
  const state = effect.createState ? effect.createState(m, 7) : undefined;
  const out: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f * 20;
    const triggers: Trigger[] = [{ seq: 1, drumId: 'kick', note: 36, velocity: 1, timeMs: 0, ageMs: t }];
    if (t >= 60) triggers.push({ seq: 2, drumId: 'snare', note: 38, velocity: 0.6, timeMs: 60, ageMs: t - 60 });
    const fb = new Framebuffer(m.pixelCount);
    effect.render(ctxAt(m, t, triggers), params, fb, state);
    out.push(fb.rgba.slice());
  }
  return out;
}

describe('Noise / Particles / Pattern registry', () => {
  it.each(KINDS)('%s hosts exactly the spec Style mapping, each effect once, all registered and not deprecated', (kind) => {
    const def = getGeneratorDef(kind)!;
    expect(def.styles.map((s) => s.effectId)).toEqual(MAPPING[kind]);
    expect(new Set(def.styles.map((s) => s.id)).size).toBe(def.styles.length);
    for (const s of def.styles) {
      const hosted = tryGetEffect(s.effectId);
      expect(hosted, s.effectId).toBeDefined();
      expect(hosted!.deprecated, s.effectId).toBeUndefined();
    }
  });

  it.each(KINDS)('%s is listed with a label, description, icon and a default (first) Style', (kind) => {
    const def = listGenerators().find((g) => g.id === kind);
    expect(def).toBeDefined();
    expect(def!.label).not.toBe('');
    expect(def!.description).toBeTruthy();
    expect(def!.icon).toBeTruthy();
    expect(resolveGenerator(device(kind, ''))?.effectId).toBe(MAPPING[kind][0]);
  });

  it('an unknown Style of a field kind resolves to null without throwing', () => {
    for (const kind of KINDS) expect(resolveGenerator(device(kind, 'no-such-style'))).toBeNull();
    expect(generatorParamSpec('noise', 'no-such-style')).toEqual([]);
  });
});

describe('Style param specs', () => {
  it('every Style shows the hosted effect params in order (no Style fixes or hides any)', () => {
    for (const kind of KINDS) {
      for (const style of getGeneratorDef(kind)!.styles) {
        expect(generatorParamSpec(kind, style.id).map((p) => p.key)).toEqual(getEffect(style.effectId).paramSpec.map((p) => p.key));
      }
    }
  });

  it('the "Hue Base" param of lava-lamp, caustics and fire reads "Hue", like the other Noise Styles', () => {
    for (const style of ['lava-lamp', 'caustics', 'fire']) {
      expect(getEffect(getGeneratorDef('noise')!.styles.find((s) => s.id === style)!.effectId).paramSpec.find((p) => p.key === 'hue')?.label).toBe('Hue Base');
      expect(generatorParamSpec('noise', style).find((p) => p.key === 'hue')?.label).toBe('Hue');
    }
    for (const style of ['plasma', 'clouds']) expect(generatorParamSpec('noise', style).find((p) => p.key === 'hue')?.label).toBe('Hue');
  });
});

describe('rendering through the Generator is identical to the implementation (default params)', () => {
  const m = model();
  const cases = KINDS.flatMap((kind) => getGeneratorDef(kind)!.styles.map((s) => [kind, s.id, s.effectId] as const));

  it.each(cases)('%s / %s ≡ %s', (kind, styleId, effectId) => {
    const resolved = resolveGenerator(device(kind, styleId))!;
    expect(resolved.effectId).toBe(effectId);
    const hosted = getEffect(resolved.effectId);
    const viaGenerator = renderSequence(hosted, { ...defaultParams(hosted.paramSpec), ...resolved.params }, m);
    const direct = renderSequence(getEffect(effectId), defaultParams(getEffect(effectId).paramSpec), m);
    // Non-vacuous: the oracle sequence actually lights pixels.
    expect(direct.some((frame) => frame.some((v) => v > 0))).toBe(true);
    expect(viaGenerator).toEqual(direct);
  });

  it.each(cases)('%s / %s fires through the Effect path hosting %s at its spec defaults', (kind, styleId, effectId) => {
    const effect = parseEffect({
      id: 'fx', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind, style: styleId },
    });
    const action = effectPlayAction(effect, { velocity: 1, sourceDrumId: 'kick', bpm: 120, layerOrder: 0 });
    expect(action?.effectId).toBe(chainEffectDefId(effectId));
    expect(action?.params).toEqual(defaultParams(getEffect(effectId).paramSpec));
  });

  it('authored device params still win over the hosted defaults', () => {
    expect(resolveGenerator(device('pattern', 'checker', { cols: 3 }))).toEqual({ effectId: 'checker-pulse', params: { cols: 3 } });
  });
});
