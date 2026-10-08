import { describe, expect, it } from 'vitest';
import { parseKit } from '../../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../../geometry/pixel-model';
import { Framebuffer } from '../../engine/framebuffer';
import type { RenderContext, Trigger } from '../../engine/render-context';
import { tryGetEffect } from '../../effects/registry';
import { defaultParams, type EffectGenerator, type ResolvedParams } from '../../effects/types';
import { chaseBands } from '../../effects/impl/chase-bands';
import { scanPlane } from '../../effects/impl/scan-plane';
import { wipe3d } from '../../effects/impl/wipe-3d';
import { radialWash } from '../../effects/impl/radial-wash';
import { ripple3d } from '../../effects/impl/ripple-3d';
import { ripplePond } from '../../effects/impl/ripple-pond';
import { drumSonar } from '../../effects/impl/drum-sonar';
import { spiral } from '../../effects/impl/spiral';
import { helix } from '../../effects/impl/helix';
import { tunnel } from '../../effects/impl/tunnel';
import { orbitComet } from '../../effects/impl/orbit-comet';
import { orbitRings } from '../../effects/impl/orbit-rings';
import { cometTrails } from '../../effects/impl/comet-trails';
import { interference } from '../../effects/impl/interference';
import { syncedHoops } from '../../effects/impl/synced-hoops';
import { spatialField } from '../../effects/impl/spatial-field';
import { generatorParamSpec, getGeneratorDef, resolveGenerator } from './index';

/** The spec's Wave mapping: Style id → the existing implementation it hosts. */
const WAVE_STYLES: ReadonlyArray<[string, EffectGenerator<any>]> = [
  ['chase', chaseBands],
  ['scan', scanPlane],
  ['wipe', wipe3d],
  ['radial', radialWash],
  ['ripple', ripple3d],
  ['pond', ripplePond],
  ['sonar', drumSonar],
  ['spiral', spiral],
  ['helix', helix],
  ['tunnel', tunnel],
  ['orbit', orbitComet],
  ['rings', orbitRings],
  ['comets', cometTrails],
  ['interference', interference],
  ['synced', syncedHoops],
  ['field', spatialField],
];

function model(): PixelModel {
  const drums = [0, 1].map((i) => ({
    id: `d${i}`,
    diameterIn: 8,
    hoopSpacingMm: 50,
    origin: { x: i * 600, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  }));
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 40, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums,
  }));
}

function ctxAt(m: PixelModel, timeMs: number): RenderContext {
  const beat = timeMs / 500;
  const trig: Trigger = { seq: 1, drumId: 'd0', note: 36, velocity: 1, ageMs: timeMs, timeMs: 0 };
  return {
    model: m,
    timeMs,
    dt: 16,
    transport: { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true },
    triggers: [trig],
  };
}

/** Frames of one hit's life, with state carried across frames like the engine does. */
function renderFrames(effect: EffectGenerator<any>, m: PixelModel, params: ResolvedParams): number[][] {
  const state = effect.createState ? effect.createState(m) : undefined;
  return [0, 16, 120, 400, 900].map((t) => {
    const fb = new Framebuffer(m.pixelCount);
    effect.render(ctxAt(m, t), params, fb, state);
    return Array.from(fb.rgba);
  });
}

describe('Wave generator', () => {
  const def = getGeneratorDef('wave')!;

  it('has exactly the spec Style mapping, each hosting a live, registered effect', () => {
    expect(def.styles.map((s) => [s.id, s.effectId])).toEqual(WAVE_STYLES.map(([id, e]) => [id, e.id]));
    for (const s of def.styles) {
      const hosted = tryGetEffect(s.effectId);
      expect(hosted, s.effectId).toBeDefined();
      expect(hosted!.deprecated, s.effectId).toBeUndefined();
    }
    expect(new Set(def.styles.map((s) => s.effectId)).size).toBe(def.styles.length);
  });

  it('has no separate wave-collapse Style (merged into Radial)', () => {
    expect(def.styles.some((s) => s.effectId === 'wave-collapse')).toBe(false);
  });

  it('an empty style resolves to the first Style (Chase)', () => {
    expect(resolveGenerator({ kind: 'wave', style: '', params: {} })?.effectId).toBe('chase-bands');
  });

  it('an unknown Style resolves to null without throwing', () => {
    expect(resolveGenerator({ kind: 'wave', style: 'wave-collapse', params: {} })).toBeNull();
    expect(generatorParamSpec('wave', 'nope')).toEqual([]);
  });

  it.each(WAVE_STYLES)('Style %s at defaults renders identically to the implementation directly', (style, impl) => {
    const m = model();
    const resolved = resolveGenerator({ kind: 'wave', style, params: {} })!;
    const hosted = tryGetEffect(resolved.effectId)!;
    const viaGenerator = renderFrames(hosted, m, { ...defaultParams(hosted.paramSpec), ...resolved.params });
    const direct = renderFrames(impl, m, defaultParams(impl.paramSpec));
    expect(viaGenerator).toEqual(direct);
    // The golden compares real light, not two dark frames.
    expect(direct.flat().some((v) => v > 0)).toBe(true);
  });

  it('authored params pass through to the hosted effect', () => {
    expect(resolveGenerator({ kind: 'wave', style: 'radial', params: { mode: 'in', hue: 10 } })?.params)
      .toEqual({ mode: 'in', hue: 10 });
  });

  it.each(WAVE_STYLES)('Style %s card shows every param of its implementation (bar a hidden dead decay)', (style, impl) => {
    const hidden = new Set(getGeneratorDef('wave')!.styles.find((s) => s.id === style)?.hiddenParams ?? []);
    expect(generatorParamSpec('wave', style).map((p) => p.key)).toEqual(impl.paramSpec.map((p) => p.key).filter((k) => !hidden.has(k)));
  });

  it('only Radial hides its decay — the waves whose life shapes the picture keep it', () => {
    expect(generatorParamSpec('wave', 'radial').some((p) => p.key === 'decayMs')).toBe(false);
    for (const style of ['scan', 'sonar', 'field', 'ripple']) expect(generatorParamSpec('wave', style).some((p) => p.key === 'lifeMs')).toBe(true);
  });

  it('common params carry consistent labels across every Style', () => {
    const common: Record<string, string> = { hue: 'Colour', saturation: 'Saturation', brightness: 'Brightness', speed: 'Speed' };
    for (const [style] of WAVE_STYLES) {
      for (const p of generatorParamSpec('wave', style)) {
        if (common[p.key]) expect(p.label, `${style}.${p.key}`).toBe(common[p.key]);
      }
    }
  });

  it('the Radial card exposes radial-wash mode (where its collapse mode lives)', () => {
    const mode = generatorParamSpec('wave', 'radial').find((p) => p.key === 'mode');
    expect(mode?.type).toBe('enum');
    expect(mode?.options).toEqual(radialWash.paramSpec.find((p) => p.key === 'mode')!.options);
  });
});
