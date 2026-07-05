import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, defaultEnvelope, type GraphEdge, type GraphNode, type TriggerCtx, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

/* S34 — modulation GRAPH layer (offline sim). Proves the full graph→voice path in the offline
   preview: an envelope SOURCE node wired to a play node's exposed `param:<key>` row resolves
   (via the shared core resolver) into the spawned voice's `modulations`, and the offline
   renderer's param sweep animates the param over the voice life. Companion to the engine-seam
   coverage in core (modulation-graph.test.ts). */

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
const envNode = (id: string, shape = defaultEnvelope('rise')): GraphNode =>
  makeNode('envelope', id, 0, 0, { env: { [voice.ENVELOPE_NODE_KEY]: shape } });
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });

/** trigger → play('gen:chase-bands'), with an envelope wired to the play node's `brightness` row. */
function envToBrightness(): TriggerGraph {
  return {
    nodes: [trigger(), playNode('gen:chase-bands'), envNode('e')],
    edges: [edge('flow', 'trigger', 'p'), edge('mod', 'e', 'p', { toPort: 'param:brightness' })],
  };
}

function totalRgb(buf: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]!;
  return s;
}

/** Fire, advance to `targetMs` in ~120ms steps, render, return total brightness. */
function renderAt(graph: TriggerGraph, targetMs: number): number {
  const lab = buildLabModel();
  const sim = freshSim();
  sim.triggerGraph('test', graph, ctx('kick'));
  let t = 0;
  while (t < targetMs) {
    sim.tick(120);
    t += 120;
  }
  const buf = new Uint8Array(lab.model.count * 3);
  renderFrame(buf, sim, lab);
  return totalRgb(buf);
}

describe('sim — modulation graph resolution', () => {
  it('an envelope wired to a play param resolves onto the spawned voice', () => {
    const sim = freshSim();
    sim.triggerGraph('test', envToBrightness(), ctx('kick'));
    expect(sim.voices.length).toBe(1);
    expect(sim.voices[0]!.modulations).toHaveLength(1);
    expect(sim.voices[0]!.modulations![0]!.targetParam).toBe('brightness');
  });

  it('an unwired envelope leaves the voice with no modulations (hot path)', () => {
    const graph: TriggerGraph = {
      nodes: [trigger(), playNode('gen:chase-bands'), envNode('e')],
      edges: [edge('flow', 'trigger', 'p')],
    };
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    expect(sim.voices[0]!.modulations).toBeUndefined();
  });

  it('the envelope animates the param per hit (a rise lifts brightness across the voice life)', () => {
    const early = renderAt(envToBrightness(), 120); // phase ~0.08 → dim
    const late = renderAt(envToBrightness(), 1320); // phase ~0.88 → bright
    expect(late).toBeGreaterThan(early);
  });

  it('an envelope node does not fire as a trigger-flow child (inert source)', () => {
    const graph: TriggerGraph = {
      nodes: [trigger(), envNode('e'), playNode('gen:chase-bands')],
      edges: [edge('e0', 'trigger', 'e'), edge('e1', 'e', 'p')],
    };
    const sim = freshSim();
    sim.triggerGraph('test', graph, ctx('kick'));
    expect(sim.voices.length).toBe(0);
  });
});
