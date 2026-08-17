import { describe, expect, it } from 'vitest';
import { acceptsPendingWire, toPortOf, typesForPendingWire, type PendingWire } from './pending-wire';
import { ADD_NODE_TYPES } from './add-node-taxonomy';
import { makeNode, type NodeKind, type TriggerGraph } from '../../trigger-lab/sim';

/* F8 — the validity filter behind "release a wire in empty space → the Add-node palette".
   Every verdict here comes from the store's own `canConnect` (probed with a stand-in node), so
   these tests pin the ROUTING (which port each source kind aims at), not a second rule table. */

const graph = (...kinds: Array<[string, NodeKind]>): TriggerGraph => ({
  version: 3,
  nodes: [makeNode('trigger', 'trigger', 0, 0), ...kinds.map(([id, kind]) => makeNode(kind, id, 100, 0))],
  edges: [],
});

const kindsFor = (g: TriggerGraph, from: PendingWire): NodeKind[] =>
  typesForPendingWire(g, from, ADD_NODE_TYPES).map((t) => t.kind);

const source = (nodeId: string, handleId: string | null = null): PendingWire => ({ nodeId, type: 'source', handleId });
const target = (nodeId: string, handleId: string | null = null): PendingWire => ({ nodeId, type: 'target', handleId });

describe('toPortOf', () => {
  it('maps the mod handle, a param row, and everything else to the flow input', () => {
    expect(toPortOf('mod')).toBe('mod');
    expect(toPortOf('param:life')).toBe('param:life');
    expect(toPortOf('in')).toBeUndefined();
    expect(toPortOf(null)).toBeUndefined();
  });
});

describe('typesForPendingWire', () => {
  it('offers every flow-input kind for a wire leaving an ordinary output', () => {
    const kinds = kindsFor(graph(['fx', 'effect']), source('fx'));
    // every kind that takes a flow input — the modulation family (no flow input) is excluded
    expect(kinds).toContain('effect');
    expect(kinds).toContain('mix');
    expect(kinds).toContain('scope');
    expect(kinds).not.toContain('envelope');
  });

  it('offers only the mod-input kinds for a wire leaving a MODIFIER', () => {
    // a modifier's wire routes to a `mod` input — only play/effect and modifier take one
    expect(kindsFor(graph(['m', 'modifier']), source('m')).sort()).toEqual(['effect', 'modifier']);
  });

  it('offers only the params-bearing kinds for a wire leaving a MODULATION source', () => {
    // a `param:<key>` wire may land only on a node that carries exposable params
    expect(kindsFor(graph(['e', 'envelope']), source('e')).sort()).toEqual(['effect', 'modifier']);
  });

  it('makes the new node the SOURCE when the drag left an input handle', () => {
    // dragging off an Effect's flow input asks for something that can FEED it — a modulation
    // source has no flow output, so it is not offered
    const kinds = kindsFor(graph(['fx', 'effect']), target('fx'));
    expect(kinds).toContain('all');
    expect(kinds).not.toContain('envelope');
  });

  it('offers only modulation sources when the drag left a param row', () => {
    expect(kindsFor(graph(['fx', 'effect']), target('fx', 'param:life')).sort()).toEqual(['envelope']);
  });

  it('routes a drag off a mod input by the ADDED node kind, exactly as a body drop does', () => {
    // `dropConnect` routes a target-side drag by the kind that lands on it: a Modifier takes the
    // `mod` input it was drawn from, anything else falls back to the flow input. The palette
    // mirrors that rather than inventing a stricter rule, so a pick always wires SOMETHING.
    const kinds = kindsFor(graph(['fx', 'effect']), target('fx', 'mod'));
    expect(kinds).toContain('modifier');
    expect(kinds).toContain('all'); // → a flow wire into the Effect, as releasing on it would
    expect(kinds).not.toContain('envelope'); // a modulation source can feed neither port
  });

  it('offers nothing for a wire whose source node is not in the graph', () => {
    expect(kindsFor(graph(['fx', 'effect']), source('ghost'))).toEqual([]);
  });

  it('never lets the probe trip the duplicate or cycle guard', () => {
    // an already fully-wired source still accepts a NEW node — the probe is not in the graph
    const g = graph(['fx', 'effect'], ['out', 'output']);
    g.edges = [{ id: 'e1', from: 'fx', to: 'out' }];
    expect(acceptsPendingWire(g, source('fx'), 'mix')).toBe(true);
  });
});
