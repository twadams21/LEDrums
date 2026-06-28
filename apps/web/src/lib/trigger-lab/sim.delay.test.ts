import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { Sim, makeNode, type TriggerCtx, type TriggerGraph } from './sim';
import { BUSES, EFFECTS, PRESETS } from './fixtures';

/* Web sim deferred-fire queue — mirrors core engine.ts pending-fire behaviour.
   Verifies that delay nodes enqueue children, that siblings before the delay fire
   immediately, that nested delays chain, and that division timing matches
   computeDelayMs at a known bpm. */

function mk(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

const BPM = 120;
const EFFECT_ID = EFFECTS[0]!.id;

function baseCtx(overrides: Partial<TriggerCtx> = {}): TriggerCtx {
  return { velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: BPM, ...overrides };
}

/** Graph: trigger → play(effectId). Fires immediately. */
function immediateGraph(effectId = EFFECT_ID): TriggerGraph {
  return {
    nodes: [makeNode('trigger', 'trig', 0, 0), makeNode('play', 'p', 200, 0, { effectId })],
    edges: [{ id: 'e0', from: 'trig', to: 'p' }],
  };
}

/** Graph: trigger → delay(ms) → play(effectId). */
function delayGraph(ms: number, effectId = EFFECT_ID): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('delay', 'd', 200, 0, { delayMode: 'time', ms }),
      makeNode('play', 'p', 400, 0, { effectId }),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'd' },
      { id: 'e1', from: 'd', to: 'p' },
    ],
  };
}

/** Graph: trigger → play(immediateId) + trigger → delay(ms) → play(delayedId). */
function siblingsGraph(ms: number, immediateId = EFFECT_ID, delayedId = EFFECTS[1]?.id ?? EFFECT_ID): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('play', 'pi', 200, -50, { effectId: immediateId }),
      makeNode('delay', 'd', 200, 50, { delayMode: 'time', ms }),
      makeNode('play', 'pd', 400, 50, { effectId: delayedId }),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'pi' },
      { id: 'e1', from: 'trig', to: 'd' },
      { id: 'e2', from: 'd', to: 'pd' },
    ],
  };
}

/** Graph: trigger → delay(ms1) → delay(ms2) → play(effectId). Nested delays chain. */
function nestedDelayGraph(ms1: number, ms2: number, effectId = EFFECT_ID): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('delay', 'd1', 200, 0, { delayMode: 'time', ms: ms1 }),
      makeNode('delay', 'd2', 400, 0, { delayMode: 'time', ms: ms2 }),
      makeNode('play', 'p', 600, 0, { effectId }),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'd1' },
      { id: 'e1', from: 'd1', to: 'd2' },
      { id: 'e2', from: 'd2', to: 'p' },
    ],
  };
}

describe('delay node — deferred-fire queue', () => {
  it('fires no voice immediately when delay > 0', () => {
    const sim = mk();
    sim.triggerGraph('pad', delayGraph(250), baseCtx());
    expect(sim.voices).toHaveLength(0);
  });

  it('fires the delayed voice after the delay elapses', () => {
    const sim = mk();
    sim.triggerGraph('pad', delayGraph(250), baseCtx());

    // not yet at 249ms
    sim.tick(249);
    expect(sim.voices).toHaveLength(0);

    // at 250ms exactly — due
    sim.tick(1);
    expect(sim.voices).toHaveLength(1);
    expect(sim.voices[0]!.effectId).toBe(EFFECT_ID);
  });

  it('fires the delayed voice when a single tick crosses the threshold', () => {
    const sim = mk();
    sim.triggerGraph('pad', delayGraph(100), baseCtx());

    // one tick that jumps past 100ms
    sim.tick(200);
    expect(sim.voices).toHaveLength(1);
  });

  it('a sibling before the delay fires immediately; the delayed sibling fires later', () => {
    const sim = mk();
    const effectIds = EFFECTS.map((e) => e.id);
    if (effectIds.length < 2) return; // need two distinct effects
    const [imm, del] = effectIds as [string, string];
    sim.triggerGraph('pad', siblingsGraph(250, imm, del), baseCtx());

    // immediate sibling fires at t=0
    expect(sim.voices.map((v) => v.effectId)).toContain(imm);
    expect(sim.voices.map((v) => v.effectId)).not.toContain(del);

    // after delay elapses, delayed sibling fires
    sim.tick(250);
    expect(sim.voices.map((v) => v.effectId)).toContain(del);
  });

  it('zero-delay fires children immediately', () => {
    const sim = mk();
    sim.triggerGraph('pad', delayGraph(0), baseCtx());
    expect(sim.voices).toHaveLength(1);
  });

  it('nested delays chain: child fires only after ms1 + ms2', () => {
    const sim = mk();
    sim.triggerGraph('pad', nestedDelayGraph(100, 150), baseCtx());

    // after first delay fires (100ms) — d2 is enqueued but not yet due
    sim.tick(100);
    expect(sim.voices).toHaveLength(0); // d2 needs another 150ms

    // at 249ms — d2 not yet due
    sim.tick(149);
    expect(sim.voices).toHaveLength(0);

    // at 250ms — d2 due
    sim.tick(1);
    expect(sim.voices).toHaveLength(1);
    expect(sim.voices[0]!.effectId).toBe(EFFECT_ID);
  });

  it('division mode: 1/8 at 120bpm fires after 250ms', () => {
    const expected = voice.computeDelayMs('beats', 0, '1/8', BPM); // 30000/120 = 250ms
    expect(expected).toBeCloseTo(250);

    const graph: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trig', 0, 0),
        makeNode('delay', 'd', 200, 0, { delayMode: 'beats', division: '1/8', ms: 0 }),
        makeNode('play', 'p', 400, 0, { effectId: EFFECT_ID }),
      ],
      edges: [
        { id: 'e0', from: 'trig', to: 'd' },
        { id: 'e1', from: 'd', to: 'p' },
      ],
    };

    const sim = mk();
    sim.bpm = BPM;
    sim.triggerGraph('pad', graph, baseCtx({ bpm: BPM }));

    // just before: no voice
    sim.tick(expected - 1);
    expect(sim.voices).toHaveLength(0);

    // at or past expected: voice fires
    sim.tick(2);
    expect(sim.voices).toHaveLength(1);
  });

  it('dotted-1/8 at 120bpm fires after 375ms (250 × 1.5)', () => {
    const expected = voice.computeDelayMs('beats', 0, 'dotted-1/8', BPM); // 375ms
    expect(expected).toBeCloseTo(375);

    const graph: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trig', 0, 0),
        makeNode('delay', 'd', 200, 0, { delayMode: 'beats', division: 'dotted-1/8', ms: 0 }),
        makeNode('play', 'p', 400, 0, { effectId: EFFECT_ID }),
      ],
      edges: [
        { id: 'e0', from: 'trig', to: 'd' },
        { id: 'e1', from: 'd', to: 'p' },
      ],
    };

    const sim = mk();
    sim.bpm = BPM;
    sim.triggerGraph('pad', graph, baseCtx({ bpm: BPM }));

    sim.tick(374);
    expect(sim.voices).toHaveLength(0);
    sim.tick(2);
    expect(sim.voices).toHaveLength(1);
  });

  it('clearPendingFires drops the queue so no voice ever spawns', () => {
    const sim = mk();
    sim.triggerGraph('pad', delayGraph(250), baseCtx());
    sim.clearPendingFires();

    sim.tick(500); // well past the delay
    expect(sim.voices).toHaveLength(0);
  });

  it('stopAll clears pending fires (panic path)', () => {
    const sim = mk();
    sim.triggerGraph('pad', immediateGraph(), baseCtx()); // one live voice
    sim.triggerGraph('pad', delayGraph(250), baseCtx()); // one pending
    expect(sim.voices).toHaveLength(1);

    sim.stopAll();
    sim.tick(500);
    // both the live and the deferred voices are gone
    expect(sim.voices.filter((v) => v.phase !== 'release' && v.level > 0)).toHaveLength(0);
    expect(sim.voices).toHaveLength(0); // all released + reaped
  });
});
