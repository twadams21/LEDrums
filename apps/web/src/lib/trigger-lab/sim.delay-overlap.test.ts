import { describe, expect, it } from 'vitest';
import { Sim, makeNode, type Bus, type EffectDef, type TriggerCtx, type TriggerGraph } from './sim';

/*
 * B1 (sim mirror) — a delayed Mix re-composition supersedes the still-live immediate composite
 * at the same (pad, mix-node) instead of stacking a second voice over the shared members. The
 * core engine test (packages/core/.../engine.delay-overlap.test.ts) is the primary gate; this
 * verifies the offline preview matches it. POLY bus on purpose: poly buses never mono-steal, so
 * only the B1 supersession — not the mono path — releases the superseded composite.
 */

// A poly bus so the immediate Mix[A] voice is NOT mono-stolen when Mix[A,B] spawns — the
// supersession is the only thing that can release it.
const BUSES: Bus[] = [{ id: 'poly', name: 'Poly', polyphony: 'poly', crossfadeMs: 0 }];

/** Long sustain so a still-live member persists across the overlap window (a pre-fix double-
    count would too); short release so the superseded voice reaps promptly. */
function fx(id: string): EffectDef {
  return { id, name: id, generatorId: 'solid-base', busId: 'poly', scope: 'kit', params: [], attackMs: 10, sustainMs: 100_000, releaseMs: 60 };
}
const EFFECTS: EffectDef[] = [fx('fxA'), fx('fxB')];

const mk = (): Sim => new Sim(BUSES.map((b) => ({ ...b })), EFFECTS.map((e) => ({ ...e })), []);
const ctx = (): TriggerCtx => ({ velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });

/** immediate A → Mix, trigger → delay(ms) → B → Mix → output. A at y=0, B at y=100. */
function mixDelayGraph(ms: number): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('play', 'a', 200, 0, { effectId: 'fxA' }),
      makeNode('delay', 'd', 200, 50, { delayMode: 'time', ms }),
      makeNode('play', 'b', 400, 100, { effectId: 'fxB' }),
      makeNode('mix', 'mix', 600, 0, { mixBlendMode: 'add' }),
      makeNode('output', 'out', 800, 0),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'a' },
      { id: 'e1', from: 'a', to: 'mix' },
      { id: 'e2', from: 'trig', to: 'd' },
      { id: 'e3', from: 'd', to: 'b' },
      { id: 'e4', from: 'b', to: 'mix' },
      { id: 'e5', from: 'mix', to: 'out' },
    ],
  };
}

/** Same topology, no delay node — the immediate baseline. */
function noDelayMixGraph(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('play', 'a', 200, 0, { effectId: 'fxA' }),
      makeNode('play', 'b', 400, 100, { effectId: 'fxB' }),
      makeNode('mix', 'mix', 600, 0, { mixBlendMode: 'add' }),
      makeNode('output', 'out', 800, 0),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'a' },
      { id: 'e1', from: 'a', to: 'mix' },
      { id: 'e2', from: 'trig', to: 'b' },
      { id: 'e3', from: 'b', to: 'mix' },
      { id: 'e4', from: 'mix', to: 'out' },
    ],
  };
}

const mixVoices = (sim: Sim) => sim.voices.filter((v) => v.mixInputs?.length);
const origins = (v: { mixInputs?: { originNodeId?: string }[] }): string[] => v.mixInputs?.map((i) => i.originNodeId ?? '?') ?? [];

describe('B1 (sim) — delayed Mix re-composition supersedes the immediate composite', () => {
  it('on drain, the immediate Mix[A] voice is released and one live composite remains', () => {
    const sim = mk();
    sim.triggerGraph('pad', mixDelayGraph(50), ctx());
    expect(mixVoices(sim)).toHaveLength(1);
    expect(origins(mixVoices(sim)[0]!)).toEqual(['a']);

    sim.tick(60); // drain B while A is still live → Mix[A,B] supersedes (releases) Mix[A]

    // Exactly one NON-releasing composite (the re-composed [A,B]); pre-fix there would be two.
    const live = mixVoices(sim).filter((v) => v.phase !== 'release');
    expect(live).toHaveLength(1);
    expect(origins(live[0]!)).toEqual(['a', 'b']);

    // The superseded [A]-only composite reaps, leaving just the [A,B] composite.
    sim.tick(200);
    expect(mixVoices(sim)).toHaveLength(1);
    expect(origins(mixVoices(sim)[0]!)).toEqual(['a', 'b']);
  });

  it('rapid double-fire keeps genuine multiplicity: two independent composites, not collapsed', () => {
    const sim = mk();
    sim.triggerGraph('pad', noDelayMixGraph(), ctx());
    sim.tick(5);
    sim.triggerGraph('pad', noDelayMixGraph(), ctx()); // a fresh fire, not a drain → no supersession
    expect(mixVoices(sim).filter((v) => v.phase !== 'release')).toHaveLength(2);
  });
});
