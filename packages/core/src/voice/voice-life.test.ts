import { describe, expect, it } from 'vitest';
import { VoicePool, type SpawnDeps } from './voice-pool';
import { advanceEnvelopes, reapDeadVoices } from './envelope-tick';
import { resolveVoiceSustainMs } from '../effects/voice-life';
import { EXP_TAIL_FACTOR, VISIBLE_CUTOFF } from '../effects/visibility';
import type { PlayAction } from './eval-graph';
import type { Bus, EffectDef, Voice } from './types';

/* The Life param used to do nothing. Every voice took its envelope from a fixed per-category
   default baked onto the EffectDef, so a 'trigger' effect was reaped ~410ms after the hit
   (attack 10 + sustain 100 + release 300) whatever its Life slider said — a chase-bands voice
   with life = 8 beats (4000ms @120bpm) died at ~450ms, and its internal `1 - age/life` fade
   never got past the first tenth. These lock the reconciliation at spawn. */

const TRIGGER_ENV = { attackMs: 10, sustainMs: 100, releaseMs: 300 }; // the 'trigger' category
const poly: Bus = { id: 'trigger', name: 'Trigger', polyphony: 'poly', crossfadeMs: 0 };

function effectDef(id: string, generatorId: string): EffectDef {
  return { id, name: id, generatorId, busId: 'trigger', scope: 'kit', params: [], ...TRIGGER_ENV };
}

function playAction(effectId: string, params: Record<string, number>, mode: 'oneshot' | 'loop' = 'oneshot'): PlayAction {
  return { kind: 'play', effectId, mode, scope: 'kit', busId: '', params, via: '', latchKey: null };
}

function spawn(effect: EffectDef, action: PlayAction, bpm = 120): Voice {
  const pool = new VoicePool();
  const deps: SpawnDeps = {
    effectsById: new Map([[effect.id, effect]]),
    busById: new Map([['trigger', poly]]),
    latched: new Map(),
    timeMs: 0,
    bpm,
  };
  const v = pool.spawn(action, 'kick', 1, deps);
  expect(v).not.toBeNull();
  return v!;
}

/** Run the real envelope tick to `timeMs` and report whether the voice is still rendering. */
function aliveAt(v: Voice, timeMs: number): boolean {
  const busById = new Map([['trigger', poly]]);
  const pool = [v];
  for (let t = 0; t <= timeMs; t += 8) {
    advanceEnvelopes(pool, t, busById);
    reapDeadVoices(pool, new Map());
  }
  return v.active;
}

describe('voice life follows the effect’s own Life param', () => {
  it('the reported bug, as a test: a chase-bands voice outlives its internal fade', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    // 8 beats @120bpm = 4000ms of visible fade.
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }));
    expect(v.sustainMs).toBe(4000);

    // The diagnostic's repro: the voice used to be reaped by ~450ms. It must now be rendering.
    expect(aliveAt(v, 450)).toBe(true);
    // Still alive at 0.9 × life, where the effect's own fade is only just finishing.
    expect(aliveAt(v, 3600)).toBe(true);
    expect(v.phase).not.toBe('release');
  });

  it('and is still reaped once its life plus release has elapsed', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }));
    // life 4000 + attack 10 + release 300, plus a frame of slack for the release ramp.
    expect(aliveAt(v, 4600)).toBe(false);
  });

  it('converts a beats life at the SPAWN bpm, matching the effect’s own conversion', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    expect(spawn(fx, playAction('fx-chase', { lifeBeats: 8 }), 60).sustainMs).toBe(8000);
    expect(spawn(fx, playAction('fx-chase', { lifeBeats: 8 }), 240).sustainMs).toBe(2000);
    expect(spawn(fx, playAction('fx-chase', { lifeBeats: 2 }), 90).sustainMs).toBeCloseTo(1333.33, 1);
  });

  it('takes an ms life verbatim', () => {
    const fx = effectDef('fx-sonar', 'drum-sonar');
    expect(spawn(fx, playAction('fx-sonar', { lifeMs: 3000 })).sustainMs).toBe(3000);
  });

  it('falls back to the generator’s spec default when the instance never set the param', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    // chase-bands defaults lifeBeats to 4 → 2000ms @120bpm.
    expect(spawn(fx, playAction('fx-chase', {})).sustainMs).toBe(2000);
  });

  it('never SHORTENS a voice below the category envelope', () => {
    const fx = effectDef('fx-comet', 'orbit-comet');
    // 0.25 beats @240bpm = 62.5ms, under the 100ms category sustain — the voice keeps 100.
    expect(spawn(fx, playAction('fx-comet', { lifeBeats: 0.25 }), 240).sustainMs).toBe(100);
  });

  it('leaves loop voices to the bus crossfade — the sustain window never releases them', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 0.5 }, 'loop'));
    // Well past attack + sustain: a oneshot would be long gone; a loop keeps rendering.
    expect(aliveAt(v, 5000)).toBe(true);
    expect(v.phase).toBe('sustain');
  });
});

describe('effects that declare no life are untouched', () => {
  it('keeps the category envelope byte-identical', () => {
    const fx = effectDef('fx-plain', 'breathing-kit'); // real effect with no life param at all
    const v = spawn(fx, playAction('fx-plain', { brightness: 1 }));
    expect(v.attackMs).toBe(TRIGGER_ENV.attackMs);
    expect(v.sustainMs).toBe(TRIGGER_ENV.sustainMs);
    expect(v.releaseMs).toBe(TRIGGER_ENV.releaseMs);
  });

  it('and so is a voice with no generator at all (canvas / mix composites)', () => {
    const fx: EffectDef = { id: 'fx-none', name: 'fx', busId: 'trigger', scope: 'kit', params: [], ...TRIGGER_ENV };
    expect(spawn(fx, playAction('fx-none', {})).sustainMs).toBe(TRIGGER_ENV.sustainMs);
  });
});

describe('exponential decays get their whole visible tail', () => {
  it('the second bug, as a test: whole-drum outlives its 410ms category envelope', () => {
    const fx = effectDef('fx-drum', 'whole-drum');
    // decayMs is a time CONSTANT, not a cutoff: at the 220ms default the drum is still lit
    // ~1.2s later, but the voice used to be reaped at ~410ms.
    const v = spawn(fx, playAction('fx-drum', { decayMs: 220 }));
    expect(v.sustainMs).toBeCloseTo(220 * EXP_TAIL_FACTOR, 5);
    expect(aliveAt(v, 880)).toBe(true); // 4 time constants — brightness ~1.8%, still drawn
    expect(aliveAt(v, 1600)).toBe(false); // past the tail + release
  });

  it('sizes the voice to the tail, not the time constant', () => {
    const fx = effectDef('fx-light', 'lightning');
    expect(spawn(fx, playAction('fx-light', { decayMs: 1000 })).sustainMs).toBeCloseTo(EXP_TAIL_FACTOR * 1000, 5);
  });

  it('derives the factor from the shared visibility cutoff rather than a magic number', () => {
    // e^-EXP_TAIL_FACTOR is exactly the brightness every impl stops drawing at.
    expect(Math.exp(-EXP_TAIL_FACTOR)).toBeCloseTo(VISIBLE_CUTOFF, 12);
  });

  it('still never shortens: a tiny decay keeps the category sustain', () => {
    const fx = effectDef('fx-drum', 'whole-drum');
    // 10ms × 5.52 = 55ms, under the 100ms category sustain.
    expect(spawn(fx, playAction('fx-drum', { decayMs: 10 })).sustainMs).toBe(100);
  });

  it('leaves factor-less (hard-cutoff) declarations exactly as they were', () => {
    expect(spawn(effectDef('fx-chase', 'chase-bands'), playAction('fx-chase', { lifeBeats: 8 })).sustainMs).toBe(4000);
    expect(spawn(effectDef('fx-sonar', 'drum-sonar'), playAction('fx-sonar', { lifeMs: 3000 })).sustainMs).toBe(3000);
    // confetti-burst's particles carry a hard remaining-life — declared, but no factor.
    expect(spawn(effectDef('fx-conf', 'confetti-burst'), playAction('fx-conf', { life: 1200 })).sustainMs).toBe(1200);
  });
});

describe('resolveVoiceSustainMs (the pure seam)', () => {
  it('passes the category sustain straight through for unknown or undeclared generators', () => {
    expect(resolveVoiceSustainMs(null, {}, 120, 100)).toBe(100);
    expect(resolveVoiceSustainMs('no-such-effect', {}, 120, 100)).toBe(100);
    expect(resolveVoiceSustainMs('breathing-kit', {}, 120, 100)).toBe(100);
  });

  it('ignores a non-numeric or negative life rather than producing a nonsense envelope', () => {
    expect(resolveVoiceSustainMs('drum-sonar', { lifeMs: 'oops' }, 120, 100)).toBe(1500); // spec default
    expect(resolveVoiceSustainMs('drum-sonar', { lifeMs: -50 }, 120, 100)).toBe(100);
  });

  it('guards a zero/absent bpm instead of dividing by it', () => {
    expect(resolveVoiceSustainMs('chase-bands', { lifeBeats: 4 }, 0, 100)).toBe(2000); // 120bpm fallback
  });
});
