import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import {
  adsrToPoints,
  cloneEnvelope,
  defaultAdsr,
  defaultEnvelope,
  ease,
  envShape,
  migrateAdsr,
  presetPoints,
  sampleEnvelope,
  type AdsrShape,
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
