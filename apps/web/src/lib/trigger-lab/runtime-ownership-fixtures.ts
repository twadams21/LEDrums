import { runtimeBus, runtimeEffect, runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { Sim, makeNode, type TriggerGraph } from './sim';

/** Real offline caller used by ownership tests and the opt-in forced-GC probe. No
 * closures retain a model/history: the Sim is deliberately the only long-lived host. */
export function ownershipSim(generatorId = 'solid-colour', pixels = 4096): Sim {
  const sim = new Sim([runtimeBus], [runtimeEffect(generatorId)], []);
  sim.pixelModel = runtimeModel([pixels]);
  fireOwnershipVoice(sim);
  warmOwnershipSim(sim);
  return sim;
}

export function fireOwnershipVoice(sim: Sim): void {
  const graph: TriggerGraph = {
    version: 3,
    nodes: [makeNode('trigger', 't', 0, 0),
      makeNode('effect', 'fx', 100, 0, { effectId: 'fx', busId: 'b', mode: 'loop', scope: 'kit' }),
      makeNode('modifier', 'echo', 200, 0, { modifierId: 'echo', params: { delayMs: 32 } }),
      makeNode('output', 'out', 300, 0)],
    edges: [['t', 'fx'], ['fx', 'echo'], ['echo', 'out']].map(([from, to], i) => ({ id: `e${i}`, from: from!, to: to! })),
  };
  sim.triggerGraph('ownership', graph, { velocity: 1, sourceDrumId: 'd0', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120 });
}

export function warmOwnershipSim(sim: Sim): void {
  for (let i = 0; i < 2; i++) { sim.tick(16); sim.render(sim.pixelModel!); }
}
