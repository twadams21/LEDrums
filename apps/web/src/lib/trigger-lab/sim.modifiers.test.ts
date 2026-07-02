import { describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, type GraphEdge, type GraphNode, type TriggerCtx, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

/* S29 — modifier GRAPH layer (offline sim). Proves the full graph→voice path: a modifier
   NODE wired to a play node's `mod` input resolves (via the shared core resolver) into the
   spawned voice's `modifiers`, and the offline renderer applies it (trail live). Companion to
   the engine-seam coverage in core (modifier-graph.test.ts + compositor.test.ts). */

function freshSim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    [...EFFECTS],
    [...PRESETS],
  );
}

function ctx(drumId = 'kick', velocity = 1): TriggerCtx {
  return { velocity, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: drumId, bpm: 120 };
}

const trigger = (): GraphNode => makeNode('trigger', 'trigger', 0, 0);
const playNode = (effectId: string): GraphNode =>
  makeNode('play', 'p', 200, 0, { effectId, presetId: `${effectId}:default`, mode: 'loop', scope: 'kit' });
const modNode = (id: string, modifierId: string, over: Partial<GraphNode> = {}): GraphNode =>
  makeNode('modifier', id, 0, 0, { modifierId, ...over });
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge =>
  ({ id, from, to, ...over });

/** trigger → play, with the given modifier nodes wired to the play node's `mod` input. */
function graphWithMods(effectId: string, mods: GraphNode[], modEdges: GraphEdge[]): TriggerGraph {
  return {
    nodes: [trigger(), playNode(effectId), ...mods],
    edges: [edge('flow', 'trigger', 'p'), ...modEdges],
  };
}

function totalRgb(buf: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]!;
  return s;
}

/** Fire a graph, render two frames (a temporal modifier needs history), return the buffer. */
function renderGraph(graph: TriggerGraph): Uint8Array {
  const lab = buildLabModel();
  const sim = freshSim();
  sim.triggerGraph('test', graph, ctx('kick'));
  sim.tick(120);
  const buf = new Uint8Array(lab.model.count * 3);
  renderFrame(buf, sim, lab);
  sim.tick(120);
  renderFrame(buf, sim, lab);
  return buf;
}

describe('sim — modifier graph resolution', () => {
  it('a Trail node wired to a play node resolves onto the spawned voice', () => {
    const graph = graphWithMods(
      'gen:plasma',
      [modNode('m', 'trail', { params: { decayMs: 800, mode: 'add' } })],
      [edge('e', 'm', 'p', { toPort: 'mod' })],
    );
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    expect(sim.voices.length).toBe(1);
    expect(sim.voices[0]!.modifiers).toEqual([{ modifierId: 'trail', params: { decayMs: 800, mode: 'add' } }]);
  });

  it('the wired Trail smears the offline render vs an unwired baseline', () => {
    const withTrail = renderGraph(
      graphWithMods(
        'gen:plasma',
        [modNode('m', 'trail', { params: { decayMs: 800, mode: 'add' } })],
        [edge('e', 'm', 'p', { toPort: 'mod' })],
      ),
    );
    const baseline = renderGraph(graphWithMods('gen:plasma', [], []));
    expect(Array.from(withTrail)).not.toEqual(Array.from(baseline));
    expect(totalRgb(withTrail)).toBeGreaterThan(totalRgb(baseline));
  });

  it('an unwired modifier node leaves the voice on the unmodified hot path', () => {
    // The modifier node exists but is NOT wired to the play node's mod input.
    const graph = graphWithMods('gen:plasma', [modNode('m', 'trail')], []);
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    expect(sim.voices[0]!.modifiers).toBeUndefined();
  });

  it('a modifier node does not fire as a trigger-flow child', () => {
    // trigger → modifier → play (flow wires). The modifier is inert, so nothing spawns.
    const graph: TriggerGraph = {
      nodes: [trigger(), modNode('m', 'trail'), playNode('gen:plasma')],
      edges: [edge('e0', 'trigger', 'm'), edge('e1', 'm', 'p')],
    };
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    expect(sim.voices.length).toBe(0);
  });

  it('parallel mod wires resolve in source y-order', () => {
    const graph = graphWithMods(
      'gen:plasma',
      [modNode('hi', 'trail', { y: 90 }), modNode('lo', 'trail', { y: 10, params: { decayMs: 100 } })],
      [edge('e0', 'hi', 'p', { toPort: 'mod' }), edge('e1', 'lo', 'p', { toPort: 'mod' })],
    );
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    const chain = sim.voices[0]!.modifiers!;
    // lo (y=10) before hi (y=90)
    expect(chain[0]!.params).toEqual({ decayMs: 100 });
    expect(chain).toHaveLength(2);
  });
});
