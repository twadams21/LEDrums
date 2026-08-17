import { describe, expect, it } from 'vitest';
import { VoicePool, type SpawnDeps } from './voice-pool';
import { advanceEnvelopes, reapDeadVoices } from './envelope-tick';
import { lifeEnvelopeGain, resolveVoiceLife, resolveVoiceSustainMs } from '../effects/voice-life';
import { EXP_TAIL_FACTOR } from '../effects/visibility';
import { evalCurve, type CurveValue } from '../curve/curve';
import type { PlayAction } from './eval-graph';
import type { Bus, EffectDef, Voice } from './types';

/* S6b — a voice's life authored as a SHAPE rather than a number. The scalar path (#182) still
   sets the envelope's time span, so an envelope whose end handle sits at the right edge is
   byte-for-byte what the effect did before curves existed. Everything below either locks that
   equivalence or pins what the curve changes. */

const TRIGGER_ENV = { attackMs: 10, sustainMs: 100, releaseMs: 300 }; // the 'trigger' category
const poly: Bus = { id: 'trigger', name: 'Trigger', polyphony: 'poly', crossfadeMs: 0 };

function effectDef(id: string, generatorId: string): EffectDef {
  return { id, name: id, generatorId, busId: 'trigger', scope: 'kit', params: [], ...TRIGGER_ENV };
}

function playAction(
  effectId: string,
  params: Record<string, number>,
  lifeEnvelope?: CurveValue,
  mode: 'oneshot' | 'loop' = 'oneshot',
): PlayAction {
  return { kind: 'play', effectId, mode, scope: 'kit', busId: '', params, lifeEnvelope, via: '', latchKey: null };
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

/** Drive the real per-frame tick to `timeMs`, collecting the level at each frame. */
function levels(v: Voice, timeMs: number, stepMs = 8): { t: number; level: number; active: boolean }[] {
  const busById = new Map([['trigger', poly]]);
  const pool = [v];
  const out: { t: number; level: number; active: boolean }[] = [];
  for (let t = 0; t <= timeMs; t += stepMs) {
    advanceEnvelopes(pool, t, busById);
    reapDeadVoices(pool, new Map());
    out.push({ t, level: v.level, active: v.active });
  }
  return out;
}

/** The level the tick lands on at a given age (the frame at or just past it). */
function levelAt(v: Voice, ageMs: number): number {
  return levels(v, ageMs).at(-1)!.level;
}

const fall = (profile: CurveValue['profile'], strength = 0.5): CurveValue => ({
  h0: { x: 0, y: 1 },
  h1: { x: 1, y: 0 },
  profile,
  strength,
});

describe('A(t) — the authored amplitude at a voice age', () => {
  it('is flat outside the handles, whatever the profile', () => {
    const held: CurveValue = { h0: { x: 0.25, y: 0.8 }, h1: { x: 0.75, y: 0.2 }, profile: 'bend', strength: 0.7 };
    expect(lifeEnvelopeGain(held, 0, 1000)).toBeCloseTo(0.8, 10);
    expect(lifeEnvelopeGain(held, 200, 1000)).toBeCloseTo(0.8, 10); // still inside the hold
    expect(lifeEnvelopeGain(held, 900, 1000)).toBeCloseTo(0.2, 10);
    expect(lifeEnvelopeGain(held, 99_999, 1000)).toBeCloseTo(0.2, 10); // past the curve entirely
  });

  it('traces every profile between the handles, across the whole strength fader', () => {
    const span = 1000;
    // the notch: strength 0 is exactly linear, so the midpoint is exactly half way down.
    expect(lifeEnvelopeGain(fall('bend', 0), 500, span)).toBeCloseTo(0.5, 10);
    // above the notch `bend` is an ease-OUT: already past half way at the midpoint…
    expect(lifeEnvelopeGain(fall('bend', 0.664), 500, span)).toBeLessThan(0.5);
    // …and below it the exact inverse, still holding above half way (F4's bipolar fader).
    expect(lifeEnvelopeGain(fall('bend', -0.664), 500, span)).toBeGreaterThan(0.5);
    // sCurve is symmetric about the midpoint, so it lands on half regardless of strength.
    expect(lifeEnvelopeGain(fall('sCurve', 0.9), 500, span)).toBeCloseTo(0.5, 10);
    // snap holds the start level until the end handle, then steps.
    expect(lifeEnvelopeGain(fall('snap'), 999, span)).toBe(1);
    expect(lifeEnvelopeGain(fall('snap'), 1000, span)).toBe(0);
  });

  it('collapses every curvable profile to linear at the centre notch, exactly', () => {
    for (const p of ['bend', 'sCurve'] as const) {
      for (const u of [0.1, 0.37, 0.5, 0.82]) {
        // No reference curve to compare against any more — strength 0 IS linear, so the
        // straight line is the arithmetic 1 − u rather than another profile's output.
        expect(lifeEnvelopeGain(fall(p, 0), u * 1000, 1000)).toBeCloseTo(1 - u, 12);
      }
    }
  });

  it('is total: no envelope, no span, and a garbage curve all resolve', () => {
    expect(lifeEnvelopeGain(undefined, 500, 1000)).toBe(1);
    expect(lifeEnvelopeGain(null, 500, 1000)).toBe(1);
    // A zero span has no axis to walk, so the voice sits at the curve's end value.
    expect(lifeEnvelopeGain(fall('bend', 0), 0, 0)).toBe(0);
    const junk = { h0: { x: NaN, y: 5 }, h1: { x: -1, y: 0.5 }, profile: 'nope', strength: 9 } as unknown as CurveValue;
    expect(Number.isFinite(lifeEnvelopeGain(junk, 100, 1000))).toBe(true);
  });
});

describe('the envelope replaces the scalar life as the voice’s end', () => {
  it('an end handle at the right edge is byte-for-byte the #182 sustain', () => {
    for (const [generatorId, params] of [
      ['chase-bands', { lifeBeats: 8 }],
      ['whole-drum', { decayMs: 220 }],
      ['segments', { lifeBeats: 3 }],
      ['drum-sonar', { lifeMs: 3000 }],
    ] as const) {
      const scalar = resolveVoiceSustainMs(generatorId, params, 120, TRIGGER_ENV.sustainMs);
      const withCurve = resolveVoiceLife(generatorId, params, 120, TRIGGER_ENV.sustainMs, fall('bend'));
      expect(withCurve.sustainMs).toBeCloseTo(scalar, 10);
      expect(withCurve.spanMs).toBeCloseTo(scalar, 10);
    }
  });

  it('an end handle dragged left shortens the voice in proportion', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const half: CurveValue = { ...fall('bend', 0), h1: { x: 0.5, y: 0 } };
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, half));
    expect(v.lifeSpanMs).toBe(4000); // the axis is still the effect's declared life
    expect(v.sustainMs).toBe(2000); // …but the voice ends where the curve does
  });

  it('resolves ms and beats spans exactly where the scalar path does', () => {
    const curve = fall('bend', 0);
    expect(resolveVoiceLife('drum-sonar', { lifeMs: 3000 }, 120, 100, curve).spanMs).toBe(3000);
    expect(resolveVoiceLife('chase-bands', { lifeBeats: 8 }, 60, 100, curve).spanMs).toBe(8000);
    expect(resolveVoiceLife('chase-bands', { lifeBeats: 8 }, 240, 100, curve).spanMs).toBe(2000);
    // …including the exponential tail factor, so an `exp`-decay effect's axis is its VISIBLE life.
    expect(resolveVoiceLife('whole-drum', { decayMs: 220 }, 120, 100, curve).spanMs).toBeCloseTo(
      220 * EXP_TAIL_FACTOR,
      10,
    );
  });

  it('normalises a malformed curve at spawn rather than storing it raw', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const backwards = { h0: { x: 0.9, y: 0 }, h1: { x: 0.2, y: 1 }, profile: 'bend', strength: 0.5 } as CurveValue;
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, backwards));
    expect(v.lifeEnvelope!.h0.x).toBe(0.2);
    expect(v.lifeEnvelope!.h1.x).toBe(0.9);
  });
});

describe('absence of an envelope is today’s behaviour', () => {
  it('leaves the resolved life untouched on effects that declare one', () => {
    // The regression lock: these are the exact numbers voice-life.test.ts pins for the scalar path.
    expect(spawn(effectDef('fx-chase', 'chase-bands'), playAction('fx-chase', { lifeBeats: 8 })).sustainMs).toBe(4000);
    expect(spawn(effectDef('fx-drum', 'whole-drum'), playAction('fx-drum', { decayMs: 220 })).sustainMs).toBeCloseTo(
      220 * EXP_TAIL_FACTOR,
      5,
    );
  });

  it('and on effects that declare none', () => {
    const v = spawn(effectDef('fx-plain', 'breathing-kit'), playAction('fx-plain', { brightness: 1 }));
    expect(v.sustainMs).toBe(TRIGGER_ENV.sustainMs);
    expect(v.lifeEnvelope).toBeNull();
  });

  it('holds the level flat at 1 through sustain, as it always did', () => {
    const v = spawn(effectDef('fx-chase', 'chase-bands'), playAction('fx-chase', { lifeBeats: 8 }));
    for (const t of [200, 1000, 2400, 3800]) expect(levelAt(v, t)).toBe(1);
  });
});

describe('the voice’s brightness follows the authored curve', () => {
  it('falls along the curve instead of holding flat', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const curve = fall('bend', 0);
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, curve)); // span 4000ms
    // Sampled against the curve itself: the tick is applying A(t), not an approximation of it.
    for (const t of [400, 1200, 2000, 3200]) {
      expect(levelAt(v, t)).toBeCloseTo(evalCurve(curve, t / 4000), 6);
    }
  });

  it('reaches the release phase at the curve’s end, and fades from where the curve left it', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    // Ends half way down: the voice is still at 0.4 when its dwell runs out.
    const held: CurveValue = { h0: { x: 0, y: 1 }, h1: { x: 0.5, y: 0.4 }, profile: 'bend', strength: 0 };
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, held));
    expect(v.sustainMs).toBe(2000);

    const trace = levels(v, 2600);
    const atEnd = trace.find((f) => f.t >= 2000)!;
    expect(atEnd.level).toBeCloseTo(0.4, 2);
    // The release ramps DOWN from that level rather than jumping back to 1 first.
    const after = trace.find((f) => f.t >= 2200)!;
    expect(after.level).toBeLessThan(0.4);
    expect(after.level).toBeGreaterThan(0);
    expect(v.phase).toBe('release');
  });

  it('a curve that ends at zero leaves nothing to fade and the voice is reaped', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, fall('bend', 0)));
    expect(levels(v, 4400).at(-1)!.active).toBe(false);
  });

  it('leaves loop voices to the bus crossfade — the sustain window still never releases them', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    // 0.5 beats = 250ms span; a oneshot would be long gone by 5s.
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 0.5 }, fall('bend', 0), 'loop'));
    expect(levels(v, 5000).at(-1)!.active).toBe(true);
    expect(v.phase).toBe('sustain');
  });

  it('never blocks the attack→sustain transition, however low the curve starts', () => {
    const fx = effectDef('fx-chase', 'chase-bands');
    const quiet: CurveValue = { h0: { x: 0, y: 0.05 }, h1: { x: 1, y: 0 }, profile: 'bend', strength: 0 };
    const v = spawn(fx, playAction('fx-chase', { lifeBeats: 8 }, quiet));
    levels(v, 100);
    expect(v.phase).toBe('sustain');
  });
});
