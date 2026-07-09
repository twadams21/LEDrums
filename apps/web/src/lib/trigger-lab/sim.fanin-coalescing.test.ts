import { describe, expect, it } from 'vitest';
import { Sim, makeNode, type TriggerCtx, type TriggerGraph } from './sim';
import { BUSES, EFFECTS, PRESETS } from './fixtures';

/*
 * R14 — Fan-in to one Effect coalesces, through the OFFLINE PREVIEW (Sim). The sim delegates
 * Gen3 eval to core (R16), so coalescing happens in the core evaluator; this verifies the
 * preview follows it end-to-end (one voice per firing, not one per converging edge) and that a
 * delayed re-arrival at the same Effect spawns a SECOND voice — a distinct temporal firing.
 * Core-seam multiplicity is unit-tested in packages/core/src/voice/eval-graph.fanin-coalescing.
 */

function mk(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

const A = EFFECTS[0]!;
const ctx = (): TriggerCtx => ({ velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });

/** Two flow paths converge on ONE play node X: trigger → p → X and trigger → q → X. */
function faninGraph(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('all', 'p', 200, 0),
      makeNode('all', 'q', 200, 100),
      makeNode('play', 'x', 400, 0, { effectId: A.id }),
      makeNode('output', 'out', 600, 0),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'p' },
      { id: 'e1', from: 'trig', to: 'q' },
      { id: 'e2', from: 'p', to: 'x' },
      { id: 'e3', from: 'q', to: 'x' },
      { id: 'e4', from: 'x', to: 'out' },
    ],
  };
}

/** Fan-in (p, q) into X plus a delayed branch into the SAME X. */
function faninDelayGraph(ms: number): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trig', 0, 0),
      makeNode('all', 'p', 200, 0),
      makeNode('all', 'q', 200, 100),
      makeNode('delay', 'd', 200, 200, { delayMode: 'time', ms }),
      makeNode('play', 'x', 400, 0, { effectId: A.id }),
      makeNode('output', 'out', 600, 0),
    ],
    edges: [
      { id: 'e0', from: 'trig', to: 'p' },
      { id: 'e1', from: 'trig', to: 'q' },
      { id: 'e2', from: 'p', to: 'x' },
      { id: 'e3', from: 'q', to: 'x' },
      { id: 'e4', from: 'trig', to: 'd' },
      { id: 'e5', from: 'd', to: 'x' },
      { id: 'e6', from: 'x', to: 'out' },
    ],
  };
}

const xVoices = (sim: Sim) => sim.voices.filter((v) => v.effectId === A.id);

describe('R14 fan-in coalescing — offline preview', () => {
  it('two paths into one Effect spawn a single voice, not one per edge', () => {
    const sim = mk();
    sim.triggerGraph('pad', faninGraph(), ctx());
    expect(xVoices(sim)).toHaveLength(1);
  });

  it('a delayed re-arrival at the same Effect spawns a second, distinct voice', () => {
    const sim = mk();
    sim.triggerGraph('pad', faninDelayGraph(50), ctx());
    const immediate = xVoices(sim);
    expect(immediate, 'immediate fan-in is one coalesced voice').toHaveLength(1);
    const bornImmediate = immediate[0]!.bornAtMs;

    sim.tick(51); // drain the delayed branch
    // Lifecycle-robust: the delayed branch is a distinct firing → a voice born at the drain
    // (t≈50), regardless of whether the immediate voice has since decayed or been replaced.
    const delayed = xVoices(sim).find((v) => v.bornAtMs > bornImmediate);
    expect(delayed, 'the delayed branch spawned its own voice — a separate temporal firing').toBeTruthy();
  });
});
