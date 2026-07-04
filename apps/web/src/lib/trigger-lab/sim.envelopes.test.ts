import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import {
  adsrToPoints,
  applyModulations,
  cloneEnvelope,
  defaultAdsr,
  defaultEnvelope,
  ease,
  envelopeToMapping,
  envShape,
  migrateAdsr,
  presetPoints,
  sampleEnvelope,
  type AdsrShape,
  type Mapping,
  type ParamSpec,
} from './sim.envelopes';

/* The web sim's envelope shape/easing/sampling is single-sourced in `@ledrums/core`
   (S23). These tests assert it is *imported*, not copied: the web-facing symbol and
   the core symbol are the same reference, so the two can never drift. */

describe('sim.envelopes — single-sourced from @ledrums/core', () => {
  it('re-exports the exact core functions (reference identity, not a copy)', () => {
    expect(sampleEnvelope).toBe(voice.sampleEnvelope);
    expect(adsrToPoints).toBe(voice.adsrToPoints);
    expect(migrateAdsr).toBe(voice.migrateAdsr);
    expect(ease).toBe(voice.ease);
    expect(envShape).toBe(voice.envShape);
    expect(presetPoints).toBe(voice.presetPoints);
    expect(defaultEnvelope).toBe(voice.defaultEnvelope);
    expect(cloneEnvelope).toBe(voice.cloneEnvelope);
    expect(defaultAdsr).toBe(voice.defaultAdsr);
  });

  it('samples byte-identically to core across a non-trivial shape', () => {
    const shape: AdsrShape = {
      attack: 0.25,
      decay: 0.3,
      sustain: 0.4,
      release: 0.2,
      attackLevel: 0.7,
      attackEase: { fn: 'cubic', dir: 'out' },
      decayEase: { fn: 'sine', dir: 'inOut' },
      releaseEase: { fn: 'expo', dir: 'in' },
    };
    const webEnv = { ...defaultEnvelope('custom'), adsr: shape, points: adsrToPoints(shape) };
    const coreEnv = { ...voice.defaultEnvelope('custom'), adsr: shape, points: voice.adsrToPoints(shape) };
    for (let i = 0; i <= 32; i++) {
      const phase = i / 32;
      expect(sampleEnvelope(webEnv, phase)).toBe(voice.sampleEnvelope(coreEnv, phase));
    }
  });
});

/* The modulation model (doc 10, S33) is likewise single-sourced in core; the web sim's
   param sweep imports it, so the offline preview's modulation can never drift from the
   engine's. */
describe('sim.envelopes — modulation model single-sourced from @ledrums/core', () => {
  it('re-exports the exact core modulation functions (reference identity)', () => {
    expect(applyModulations).toBe(voice.applyModulations);
    expect(envelopeToMapping).toBe(voice.envelopeToMapping);
  });

  it('sweeps a param byte-identically to core across the voice life', () => {
    const spec: ParamSpec = { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 };
    const env = { ...defaultEnvelope('decay'), amount: 0.8 };
    const mapping: Mapping = envelopeToMapping('brightness', env, spec);
    for (let i = 0; i <= 16; i++) {
      const phase = i / 16;
      const webOut = { brightness: 0.5 };
      applyModulations({ brightness: 0.5 }, webOut, [mapping], [spec], { phase, timeMs: 0, bpm: 120 });
      const coreOut = { brightness: 0.5 };
      voice.applyModulations({ brightness: 0.5 }, coreOut, [mapping], [spec], { phase, timeMs: 0, bpm: 120 });
      expect(webOut.brightness).toBe(coreOut.brightness);
    }
  });
});
