import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../sim';
import { NODE_W } from '../sim.graph-compilation';
import { buildEmptyGraph, EMPTY_GRAPH_OUTPUT_X, widenEmptyGraphs } from './graphs';

/* A new graph's Trigger and Output start one full node slot apart, so the first Effect placed
   between them fits with room for its wires (Tim, 2026-09-28: "isn't squished"). Graphs made
   before that, still untouched, are widened on load; anything arranged by hand is left alone. */

const H_GAP = 90; // the layout gap sim.graph-compilation and graph-integrity use

const anchors = (graph: TriggerGraph) => ({
  trigger: graph.nodes.find((n) => n.kind === 'trigger')!,
  output: graph.nodes.find((n) => n.kind === 'output')!,
});

describe('buildEmptyGraph', () => {
  it('leaves room for one node, with a full gap either side, between Trigger and Output', () => {
    const { trigger, output } = anchors(buildEmptyGraph());
    const room = output.x - (trigger.x + NODE_W);
    expect(room).toBeGreaterThanOrEqual(NODE_W + 2 * H_GAP);
    expect(output.x).toBe(EMPTY_GRAPH_OUTPUT_X);
  });
});

describe('widenEmptyGraphs', () => {
  const oldEmpty = (): TriggerGraph => ({
    version: 3,
    nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('output', 'output', 420, 0)],
    edges: [],
  });

  it('moves an untouched old-width empty graph’s Output to the new spot', () => {
    const out = widenEmptyGraphs({ a: oldEmpty() });
    expect(anchors(out.a!).output.x).toBe(EMPTY_GRAPH_OUTPUT_X);
    expect(anchors(out.a!).trigger.x).toBe(0);
  });

  it('leaves a graph with any node in it, or anchors someone moved, exactly as they are', () => {
    const withEffect = oldEmpty();
    withEffect.nodes.push(makeNode('effect', 'n1', 200, 0));
    const moved = oldEmpty();
    moved.nodes[1]!.y = 80;
    const graphs = { withEffect, moved, fresh: buildEmptyGraph() };
    expect(widenEmptyGraphs(graphs)).toBe(graphs); // same map: nothing to do
  });
});
