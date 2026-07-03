import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';
import { applyFlowPositions, graphToFlow, graphToFlowEdges, graphToFlowNodes } from './graph-to-flow';

/** A small graph: trigger → all → (play, play), exercising both node + edge mapping. */
function fixture(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger', 0, 100),
      makeNode('all', 'a', 300, 100),
      makeNode('play', 'p1', 600, 40, { effectId: 'swirl', presetId: 'swirl:default' }),
      makeNode('play', 'p2', 600, 160, { effectId: 'chase', presetId: 'chase:default' }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'a' },
      { id: 'e1', from: 'a', to: 'p1' },
      { id: 'e2', from: 'a', to: 'p2' },
    ],
  };
}

describe('graphToFlowNodes', () => {
  it('maps each store node to a trigger-typed flow node at its x/y', () => {
    const nodes = graphToFlowNodes(fixture());
    expect(nodes).toHaveLength(4);
    const trig = nodes.find((n) => n.id === 'trigger')!;
    expect(trig.type).toBe('trigger');
    expect(trig.position).toEqual({ x: 0, y: 100 });
    expect(trig.data.kind).toBe('trigger');
  });

  it('marks nodes non-deletable (removal is an Inspector action, not the Delete key)', () => {
    expect(graphToFlowNodes(fixture()).every((n) => n.deletable === false)).toBe(true);
  });

  it('carries each node kind into data for handle direction', () => {
    const byId = Object.fromEntries(graphToFlowNodes(fixture()).map((n) => [n.id, n.data.kind]));
    expect(byId).toEqual({ trigger: 'trigger', a: 'all', p1: 'play', p2: 'play' });
  });
});

describe('graphToFlowEdges', () => {
  it('maps from→source, to→target, preserves the edge id, and uses the wire type', () => {
    const edges = graphToFlowEdges(fixture());
    expect(edges).toEqual([
      { id: 'e0', source: 'trigger', target: 'a', type: 'wire' },
      { id: 'e1', source: 'a', target: 'p1', type: 'wire' },
      { id: 'e2', source: 'a', target: 'p2', type: 'wire' },
    ]);
  });

  it('emits no edges for an empty graph', () => {
    expect(graphToFlowEdges({ nodes: [], edges: [] })).toEqual([]);
  });

  it("maps an edge's fromPort to the xyflow sourceHandle (a value+bands switch band)", () => {
    const g: TriggerGraph = {
      nodes: [makeNode('switch', 's', 0, 0, { on: 'value', valueMode: 'bands' }), makeNode('play', 'p', 300, 0)],
      edges: [{ id: 'e0', from: 's', to: 'p', fromPort: 'band-1' }],
    };
    expect(graphToFlowEdges(g)[0]!.sourceHandle).toBe('band-1');
  });

  it('routes a modulation edge to its `param:<key>` targetHandle and flags it for styling', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('envelope', 'e', 0, 0), makeNode('play', 'p', 300, 0)],
      edges: [{ id: 'e0', from: 'e', to: 'p', toPort: 'param:brightness' }],
    };
    const [edge] = graphToFlowEdges(g);
    expect(edge!.targetHandle).toBe('param:brightness');
    expect(edge!.data).toEqual({ modulation: true });
  });

  it('flags a mod-chain wire distinctly from a modulation wire', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('modifier', 'm', 0, 0, { modifierId: 'trail' }), makeNode('play', 'p', 300, 0)],
      edges: [{ id: 'e0', from: 'm', to: 'p', toPort: 'mod' }],
    };
    expect(graphToFlowEdges(g)[0]!.data).toEqual({ mod: true });
  });
});

describe('graphToFlow + applyFlowPositions round-trip', () => {
  it('preserves every node position through flow and back', () => {
    const g = fixture();
    const { nodes } = graphToFlow(g);
    const back = applyFlowPositions(g, nodes);
    for (const n of g.nodes) {
      const r = back.nodes.find((m) => m.id === n.id)!;
      expect([r.x, r.y]).toEqual([n.x, n.y]);
    }
  });

  it('writes moved positions back onto the matching node only', () => {
    const g = fixture();
    const moved = applyFlowPositions(g, [{ id: 'p1', position: { x: 999, y: -50 } }]);
    const p1 = moved.nodes.find((n) => n.id === 'p1')!;
    expect([p1.x, p1.y]).toEqual([999, -50]);
    // untouched node keeps its original coordinates
    const a = moved.nodes.find((n) => n.id === 'a')!;
    expect([a.x, a.y]).toEqual([300, 100]);
  });

  it('ignores unknown ids and keeps edges intact', () => {
    const g = fixture();
    const out = applyFlowPositions(g, [{ id: 'ghost', position: { x: 1, y: 2 } }]);
    expect(out.edges).toEqual(g.edges);
    expect(out.nodes.map((n) => n.id)).toEqual(['trigger', 'a', 'p1', 'p2']);
  });
});
