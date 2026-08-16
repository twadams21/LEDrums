import { describe, expect, it } from 'vitest';
import { evalCurve, lifeEnvelopeGain, resolveVoiceLife, type CurveValue } from '@ledrums/core';
import { Sim, makeNode, type TriggerCtx, type TriggerGraph } from './sim';
import { BUSES, EFFECTS, PRESETS } from './fixtures';

/* S6b — the authored life envelope driven frame by frame through the WEB SIM's real tick.

   The parity claim is closed in two halves, because the engine's voice pool is deliberately
   not part of core's public surface. THIS half proves the sim resolves through the shared
   `resolveVoiceLife` and multiplies by the shared `lifeEnvelopeGain`, frame for frame; core's
   `voice/life-envelope.test.ts` drives the REAL `VoicePool` + `advanceEnvelopes` against the
   same two functions. One implementation, both paths pinned to it — the shape #182 established
   for the scalar life, kept. */

const BPM = 120;
/** chase-bands: `lifeBeats` is a HARD cutoff, so its span is the life verbatim (4000ms @120). */
const CHASE = 'gen:chase-bands';

function mk(): Sim {
  const sim = new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
  sim.bpm = BPM;
  return sim;
}

function baseCtx(): TriggerCtx {
  return { velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: BPM };
}

/** Graph: trigger → effect, with the life param and (optionally) an authored curve on it. */
function lifeGraph(params: Record<string, number>, lifeEnvelope?: CurveValue): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('effect', 'p', 200, 0, { effectId: CHASE, params, lifeEnvelope }),
    ],
    edges: [{ id: 'e0', from: 'trig', to: 'p' }],
  };
}

/** Fire the graph, then step the sim in `stepMs` frames, reporting the voice's level each time. */
function simLevels(graph: TriggerGraph, untilMs: number, stepMs = 10): number[] {
  const sim = mk();
  sim.triggerGraph('pad', graph, baseCtx());
  const out: number[] = [];
  for (let t = stepMs; t <= untilMs; t += stepMs) {
    sim.tick(stepMs);
    out.push(sim.voices[0]?.level ?? 0);
  }
  return out;
}

/** What the engine's tick will produce for the same voice: the shared gain, applied to the
    sustain level exactly as `advanceEnvelopes` applies it. Sourced from core, not restated. */
function expectedLevels(params: Record<string, number>, lifeEnvelope: CurveValue | undefined, untilMs: number, stepMs = 10): number[] {
  const effect = EFFECTS.find((e) => e.id === CHASE)!;
  const life = resolveVoiceLife(effect.generatorId, params, BPM, effect.sustainMs, lifeEnvelope);
  const out: number[] = [];
  for (let t = stepMs; t <= untilMs; t += stepMs) {
    // Past the dwell the voice is releasing, which the curve no longer drives — compare only
    // the window the envelope owns.
    if (t > effect.attackMs + life.sustainMs) break;
    out.push(lifeEnvelopeGain(life.envelope, t, life.spanMs));
  }
  return out;
}

const linearFall: CurveValue = { h0: { x: 0, y: 1 }, h1: { x: 1, y: 0 }, profile: 'linear', strength: 0 };
const expFall: CurveValue = { h0: { x: 0, y: 1 }, h1: { x: 1, y: 0 }, profile: 'exp', strength: 0.664 };
const heldTail: CurveValue = { h0: { x: 0.2, y: 1 }, h1: { x: 0.6, y: 0.35 }, profile: 'sCurve', strength: 0.8 };

describe('the sim resolves a voice’s life through the same core helper as the engine', () => {
  it('spans and dwells agree for every shape', () => {
    const effect = EFFECTS.find((e) => e.id === CHASE)!;
    for (const curve of [undefined, linearFall, expFall, heldTail]) {
      const life = resolveVoiceLife(effect.generatorId, { lifeBeats: 8 }, BPM, effect.sustainMs, curve);
      const sim = mk();
      sim.triggerGraph('pad', lifeGraph({ lifeBeats: 8 }, curve), baseCtx());
      const v = sim.voices[0]!;
      expect(v.lifeSpanMs).toBeCloseTo(life.spanMs, 10);
      expect(v.sustainMs).toBeCloseTo(life.sustainMs, 10);
      expect(v.lifeEnvelope ?? null).toEqual(life.envelope);
    }
  });
});

describe('a voice’s brightness follows the authored curve', () => {
  for (const [name, curve] of [
    ['linear', linearFall],
    ['exp', expFall],
    ['a held tail that ends above zero', heldTail],
  ] as const) {
    it(`${name}: the sim's level is the shared gain, frame for frame`, () => {
      const params = { lifeBeats: 8 }; // 4000ms span @120bpm
      const expected = expectedLevels(params, curve, 5000);
      const sim = simLevels(lifeGraph(params, curve), 5000).slice(0, expected.length);
      expect(sim.length).toBeGreaterThan(20); // a real run, not an empty comparison
      for (const [i, level] of sim.entries()) {
        expect(level).toBeCloseTo(expected[i]!, 10);
      }
    });
  }

  it('and that level IS the curve, not an approximation of it', () => {
    const span = 4000;
    const levels = simLevels(lifeGraph({ lifeBeats: 8 }, expFall), 3600);
    // Frame i ends at (i+1)*10ms of voice age.
    for (const i of [9, 59, 179, 299]) {
      expect(levels[i]!).toBeCloseTo(evalCurve(expFall, ((i + 1) * 10) / span), 6);
    }
  });

  it('with no envelope, the sim holds flat at 1 — the pre-S6b behaviour, unchanged', () => {
    const sim = simLevels(lifeGraph({ lifeBeats: 8 }), 3600);
    expect(new Set(sim)).toEqual(new Set([1]));
  });

  it('ends the voice where the curve ends', () => {
    // h1.x = 0.25 → the dwell is a quarter of the 4000ms span.
    const quarter: CurveValue = { ...linearFall, h1: { x: 0.25, y: 0 } };
    // Past dwell (1000ms) + release (300ms): nothing left.
    expect(simLevels(lifeGraph({ lifeBeats: 8 }, quarter), 1600).at(-1)).toBe(0);
    // …while the un-curved voice is still going strong at the same moment.
    expect(simLevels(lifeGraph({ lifeBeats: 8 }), 1600).at(-1)).toBe(1);
  });
});
