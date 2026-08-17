import { describe, expect, it } from 'vitest';
import { EXP_TAIL_FACTOR, evalCurve, resolveVoiceLife, resolveVoiceSustainMs } from '@ledrums/core';
import { EXP_SEED_STRENGTH, decaySpanHint, lifeParamKey, maxBrightnessKey, seedLifeEnvelope } from './life-envelope';
import { listEffects } from '@ledrums/core';

/* Turning a scalar Life/Decay into a curve must be a no-op you can see through: the seeded
   envelope has to describe what the effect was already doing, or "draw this as a shape" is a
   surprise edit rather than a handoff. */

describe('which effects can have their life drawn', () => {
  it('is exactly those that DECLARE a life param', () => {
    expect(lifeParamKey('chase-bands')).toBe('lifeBeats');
    expect(lifeParamKey('whole-drum')).toBe('decayMs');
    expect(lifeParamKey('drum-sonar')).toBe('lifeMs');
    // Landed with S6b — segments fades on a hard `1 - ageBeats/lifeBeats` and had no declaration.
    expect(lifeParamKey('segments')).toBe('lifeBeats');
  });

  it('and nothing else — an undeclared, unknown, or absent generator offers no curve', () => {
    expect(lifeParamKey('breathing-kit')).toBeNull();
    expect(lifeParamKey('no-such-effect')).toBeNull();
    expect(lifeParamKey(null)).toBeNull();
    expect(lifeParamKey(undefined)).toBeNull();
  });
});

describe('the seeded envelope is the effect’s current behaviour', () => {
  it('spans the whole declared life and falls to nothing', () => {
    const seed = seedLifeEnvelope('chase-bands');
    expect(seed.h0).toEqual({ x: 0, y: 1 });
    expect(seed.h1).toEqual({ x: 1, y: 0 });
  });

  it('so seeding never changes how long the voice lives', () => {
    for (const [generatorId, params] of [
      ['chase-bands', { lifeBeats: 8 }],
      ['whole-drum', { decayMs: 220 }],
      ['segments', { lifeBeats: 3 }],
    ] as const) {
      const scalar = resolveVoiceSustainMs(generatorId, params, 120, 100);
      const seeded = resolveVoiceLife(generatorId, params, 120, 100, seedLifeEnvelope(generatorId));
      expect(seeded.sustainMs).toBeCloseTo(scalar, 10);
    }
  });

  it('bends the way the effect already fades: exponential where the param is a time constant', () => {
    // whole-drum declares `factor: EXP_TAIL_FACTOR` — its param IS a decay constant.
    const seed = seedLifeEnvelope('whole-drum');
    expect(seed.profile).toBe('bend');
    expect(seed.strength).toBeCloseTo(EXP_SEED_STRENGTH, 2); // quantised to the fader's step
    // The bend is calibrated against the decay it stands in for: the two agree exactly at the
    // half-way point. A power curve is not an exponential, so they only meet there — but the
    // seed is an ease-out that has fallen well past linear by then, which is the visible claim.
    expect(evalCurve(seed, 0.5)).toBeCloseTo(Math.exp(-0.5 * EXP_TAIL_FACTOR), 2);
    for (const u of [0.25, 0.5, 0.75]) expect(evalCurve(seed, u)).toBeLessThan(1 - u);
  });

  it('and linear where the effect fades on a hard 1 - age/life', () => {
    for (const generatorId of ['chase-bands', 'segments'] as const) {
      const seed = seedLifeEnvelope(generatorId);
      expect(seed.strength).toBe(0);
      // strength 0 is the fader's notch — `bend` is EXACTLY linear there, so the seed matches `1 - age/life`.
      for (const u of [0.1, 0.5, 0.9]) expect(evalCurve(seed, u)).toBeCloseTo(1 - u, 12);
    }
  });
});

/* F5 — the envelope's y axis. The top always reads 100%; what it is 100% OF is this param,
   which the effect already multiplies its own output by. */

describe('which param the max-brightness slider writes', () => {
  it('is the effect’s own output scale, for every effect that can be drawn', () => {
    const drawable = listEffects().filter((e) => e.voiceLife);
    expect(drawable.length).toBeGreaterThan(10); // guard: an empty sweep would pass vacuously
    for (const e of drawable) {
      const key = maxBrightnessKey(e.id);
      expect(key, e.id).not.toBeNull();
      // Never invented: whatever it names, the generator declared it as a number.
      const spec = e.paramSpec.find((s) => s.key === key);
      expect(spec?.type, e.id).toBe('number');
    }
  });

  it('resolves nothing rather than guessing, for an effect with no output scale', () => {
    expect(maxBrightnessKey('no-such-effect')).toBeNull();
    expect(maxBrightnessKey(null)).toBeNull();
    expect(maxBrightnessKey(undefined)).toBeNull();
  });
});

/* The envelope's span and the Decay slider are two different numbers — `decayMs: 220` spans
   ~1.21s because it is a time CONSTANT. Flagged in review of F5's own screenshot as a
   suspected unit bug, which is exactly why the readout has to say what it is. */

describe('the span readout explains itself', () => {
  it('names the time-constant relationship where the effect declares a factor', () => {
    const hint = decaySpanHint('whole-drum', { label: 'Decay' });
    expect(hint).toContain('time constant');
    expect(hint).toContain(EXP_TAIL_FACTOR.toFixed(1));
    // The two numbers really do differ by exactly that factor — the readout is not lying.
    expect(resolveVoiceSustainMs('whole-drum', { decayMs: 220 }, 120, 100)).toBeCloseTo(220 * EXP_TAIL_FACTOR, 6);
  });

  it('and says only what is true for an effect with a hard cutoff', () => {
    const hint = decaySpanHint('segments', { label: 'Decay' });
    expect(hint).not.toContain('time constant');
    expect(hint).toContain('Decay');
    // 3 beats @120bpm = 1500ms: same quantity, different UNIT, so the word "total" still earns
    // its place even here.
    expect(resolveVoiceSustainMs('segments', { lifeBeats: 3 }, 120, 100)).toBe(1500);
  });

  it('falls back to a usable label rather than printing "null"', () => {
    expect(decaySpanHint('whole-drum', null)).toContain('Decay');
    expect(decaySpanHint(null, null)).toContain('Decay');
  });
});
