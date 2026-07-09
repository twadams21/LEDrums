import { describe, expect, it } from 'vitest';
import { Sim, makeNode, type TriggerCtx, type TriggerGraph } from './sim';
import { BUSES, EFFECTS, PRESETS } from './fixtures';

/*
 * R13 — Delay = timeline shift, through the OFFLINE PREVIEW (Sim). The sim delegates Gen3
 * eval to core (R16), so this asserts the preview follows the core temporal model: a delayed
 * branch draining into a Mix composes with still-live sibling members, and drops decayed ones.
 * Core-seam parity/decayed logic is unit-tested in packages/core; here we verify the wiring
 * (origin-tagged voices + isLayerLive + snapshots) end-to-end through tick/drain.
 */

function mk(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

const A = EFFECTS[0]!;
const B = EFFECTS[1] ?? EFFECTS[0]!;
const A_LIFE = A.attackMs + A.sustainMs + Math.max(60, A.releaseMs);

const ctx = (): TriggerCtx => ({ velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });

/** immediate A → Mix, trigger → delay(ms) → B → Mix → output. A at y=0, B at y=100. */
function mixDelayGraph(ms: number): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('play', 'a', 200, 0, { effectId: A.id }),
      makeNode('delay', 'd', 200, 50, { delayMode: 'time', ms }),
      makeNode('play', 'b', 400, 100, { effectId: B.id }),
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

// Voice-level MixInputs are keyed by origin node id (R13 tag), not effectId.
const mixOrigins = (v: { mixInputs?: { originNodeId?: string }[] }): string[] => v.mixInputs?.map((i) => i.originNodeId ?? '?') ?? [];

describe('R13 delay = timeline shift — offline preview', () => {
  it('before the delay, the Mix previews only the immediate layer A', () => {
    const sim = mk();
    sim.triggerGraph('pad', mixDelayGraph(A_LIFE + 300), ctx());
    const mixVoices = sim.voices.filter((v) => v.mixInputs?.length);
    expect(mixVoices).toHaveLength(1);
    expect(mixOrigins(mixVoices[0]!)).toEqual(['a']);
  });

  it('when B fires while A is still live, the drained Mix composes [A, B] in y-order', () => {
    const sim = mk();
    const delay = Math.max(1, Math.floor((A.attackMs + A.sustainMs) / 2)); // fires mid-life, A still alive
    sim.triggerGraph('pad', mixDelayGraph(delay), ctx());

    sim.tick(delay + 1); // drain B — A is still live
    const composed = sim.voices.find((v) => mixOrigins(v).includes('b'));
    expect(composed, 'a Mix voice hosting B should exist after the delay').toBeTruthy();
    expect(mixOrigins(composed!)).toEqual(['a', 'b']);
  });

  it('when A has decayed before B fires, the drained Mix is just [B]', () => {
    const sim = mk();
    const delay = A_LIFE + 2000;
    sim.triggerGraph('pad', mixDelayGraph(delay), ctx());

    // Let A run its full envelope and reap (the phase machine advances one stage per tick).
    for (let i = 0; i < 200 && sim.voices.some((v) => mixOrigins(v).includes('a')); i++) sim.tick(40);
    expect(sim.voices.some((v) => mixOrigins(v).includes('a')), 'A should have decayed and reaped').toBe(false);
    expect(sim.timeMs).toBeLessThan(delay); // B not yet due

    sim.tick(delay - sim.timeMs + 1); // now B's delay elapses
    const composed = sim.voices.find((v) => mixOrigins(v).includes('b'));
    expect(composed, 'a Mix voice hosting B should exist after the delay').toBeTruthy();
    expect(mixOrigins(composed!)).toEqual(['b']);
  });
});
