import { describe, expect, it } from 'vitest';
import { compileRenderPlan } from './render-plan';
import type { RenderPlanIssueCode } from './render-plan';
import type { GraphEdge, GraphNode, NodeKind, TriggerGraph } from './types';

function node(kind: NodeKind, id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });

/** Ids the compiler flags with `code`, in issue order. */
function idsFor(graph: TriggerGraph, code: RenderPlanIssueCode): Array<string | undefined> {
  return compileRenderPlan(graph)
    .issues.filter((i) => i.code === code)
    .map((i) => i.nodeId);
}

describe('no-path-to-output lint', () => {
  it('flags a producer with no forward path to the Output anchor', () => {
    // effect wired to nothing (trigger fires it, but it never reaches Output).
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'fx', { effectId: 'plasma' }), node('output', 'output')],
      edges: [edge('trigger-fx', 'trigger', 'fx')],
    };

    expect(idsFor(graph, 'no-path-to-output')).toEqual(['fx']);
    // A dead render leaf is a per-branch warning, never fatal — the plan still compiles.
    expect(compileRenderPlan(graph).fatal).toBe(false);
  });

  it('flags a producer whose downstream chain dead-ends before Output', () => {
    // effect -> scope, but the scope never reaches Output: the effect can't render.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma' }),
        node('scope', 'sc'),
        node('output', 'output'),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc')],
    };

    // fx is the render leaf with no path to Output; `sc` is a producerless dead-end that also
    // never reaches Output, so it is NOT a dead-branch (dead-branch requires reaching Output).
    expect(idsFor(graph, 'no-path-to-output')).toEqual(['fx']);
    expect(idsFor(graph, 'dead-branch')).toEqual([]);
  });

  it('does not flag a producer that reaches Output', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'fx', { effectId: 'plasma' }), node('output', 'output')],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
    };

    expect(idsFor(graph, 'no-path-to-output')).toEqual([]);
    expect(idsFor(graph, 'dead-branch')).toEqual([]);
  });

  it('flags only the producers actually cut off when one of several branches survives', () => {
    // fxA reaches Output; fxB is severed. Only fxB is flagged.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fxA', { effectId: 'plasma' }),
        node('effect', 'fxB', { effectId: 'plasma' }),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-fxA', 'trigger', 'fxA'),
        edge('trigger-fxB', 'trigger', 'fxB'),
        edge('fxA-output', 'fxA', 'output'),
      ],
    };

    expect(idsFor(graph, 'no-path-to-output')).toEqual(['fxB']);
  });

  it('stays silent when there is no Output anchor (missing-output already explains it)', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('effect', 'fx', { effectId: 'plasma' })],
      edges: [edge('trigger-fx', 'trigger', 'fx')],
    };

    expect(idsFor(graph, 'no-path-to-output')).toEqual([]);
    expect(idsFor(graph, 'dead-branch')).toEqual([]);
    expect(compileRenderPlan(graph).issues.some((i) => i.code === 'missing-output')).toBe(true);
  });
});

describe('dead-branch lint', () => {
  it('flags a collector wired to Output with no producer upstream', () => {
    // trigger -> route -> Output: Output is on a live path but nothing produces a layer.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('all', 'route'), node('output', 'output')],
      edges: [edge('trigger-route', 'trigger', 'route'), edge('route-output', 'route', 'output')],
    };

    expect(idsFor(graph, 'dead-branch')).toEqual(['output']);
    expect(compileRenderPlan(graph).fatal).toBe(false);
  });

  it('anchors to the branch HEAD, not every node down a producerless chain', () => {
    // trigger -> route -> scope -> Output: both scope and Output lack a producer, but only the
    // topmost layer node (scope, where a producer should attach) wears the badge.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('all', 'route'),
        node('scope', 'sc'),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-route', 'trigger', 'route'),
        edge('route-sc', 'route', 'sc'),
        edge('sc-output', 'sc', 'output'),
      ],
    };

    expect(idsFor(graph, 'dead-branch')).toEqual(['sc']);
  });

  it('does not flag a bare trigger + Output graph (Output is unwired, not dead)', () => {
    // The canonical well-formed empty graph: Output has no incoming flow, so there is no branch
    // to call dead — no reachability findings at all.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 'trigger'), node('output', 'output')],
      edges: [],
    };

    expect(compileRenderPlan(graph).issues).toHaveLength(0);
  });

  it('does not flag a collector that has a producer upstream', () => {
    // trigger -> fx -> mix -> Output: the mix collects a real layer, so it is not dead.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma' }),
        node('mix', 'mx'),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-fx', 'trigger', 'fx'),
        edge('fx-mx', 'fx', 'mx'),
        edge('mx-output', 'mx', 'output'),
      ],
    };

    expect(idsFor(graph, 'dead-branch')).toEqual([]);
    expect(idsFor(graph, 'no-path-to-output')).toEqual([]);
  });

  it('flags each producerless branch head feeding a shared collector', () => {
    // Two producerless scopes into one Mix -> Output: each scope is its own branch head.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('all', 'route'),
        node('scope', 'scA', { y: 0 }),
        node('scope', 'scB', { y: 100 }),
        node('mix', 'mx'),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-route', 'trigger', 'route'),
        edge('route-scA', 'route', 'scA'),
        edge('route-scB', 'route', 'scB'),
        edge('scA-mx', 'scA', 'mx'),
        edge('scB-mx', 'scB', 'mx'),
        edge('mx-output', 'mx', 'output'),
      ],
    };

    expect(idsFor(graph, 'dead-branch')).toEqual(['scA', 'scB']);
  });

  it('does not flag a mix whose live and dead inputs both feed it (a producer still reaches it)', () => {
    // fx -> mix (live) and route -> mix (dead): the mix collects fx, so it renders; the dead
    // route edge is silent (a router into a collector is not a layer branch).
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma' }),
        node('all', 'route'),
        node('mix', 'mx'),
        node('output', 'output'),
      ],
      edges: [
        edge('trigger-fx', 'trigger', 'fx'),
        edge('trigger-route', 'trigger', 'route'),
        edge('fx-mx', 'fx', 'mx'),
        edge('route-mx', 'route', 'mx'),
        edge('mx-output', 'mx', 'output'),
      ],
    };

    expect(idsFor(graph, 'dead-branch')).toEqual([]);
    expect(idsFor(graph, 'no-path-to-output')).toEqual([]);
  });
});
