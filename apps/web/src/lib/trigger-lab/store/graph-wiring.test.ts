import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../sim';
import { canConnect, canReconnect, normalizeFromPort, normalizeToPort, type ToPort } from './graph-wiring';

/* Incident 09 acceptance: wiring validation must RETURN a verdict, never throw — a throw from
   a connect/reconnect guard is what propagates into xyflow mid-gesture and blanks the canvas.
   These are pure fuzz + targeted tests over the invalid-input space (unknown ids, self-connects,
   cross-graph ids, port mismatches). */

/** A small valid graph: trigger → random → play, plus an isolated toggle. */
function sampleGraph(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      makeNode('random', 'r1', 100, 0),
      makeNode('play', 'p1', 200, 0),
      makeNode('toggle', 't1', 100, 100),
      makeNode('envelope', 'env1', 0, 200),
    ],
    edges: [
      { id: 'e1', from: 'trigger', to: 'r1' },
      { id: 'e2', from: 'r1', to: 'p1' },
    ],
  };
}

/** Deterministic PRNG so a fuzz failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const graph = sampleGraph();
const knownIds = graph.nodes.map((n) => n.id);
// ids the graph does NOT contain: empty, whitespace-mangled, cross-graph-shaped, unicode, and
// dangerous prototype keys — the shapes a malformed drag / stale reference could produce.
const alienIds = ['', 'trigger ', 'r1\n', 'n:9999', '💥', 'undefined', '__proto__', 'nodes', 'toString'];
const idPool = [...knownIds, ...alienIds];
const ports: Array<string | undefined> = [undefined, 'band-0', 'band-999', '', 'default', '💥'];
const toPorts: ToPort[] = [undefined, 'in', 'mod', 'param:brightness', 'param:', 'param:💥'];

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

describe('graph-wiring validation never throws (fuzz)', () => {
  it('canConnect returns a boolean and never throws for any id/port combination', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 5000; i++) {
      const from = pick(idPool, rand);
      const to = pick(idPool, rand);
      const port = pick(ports, rand);
      const toPort = pick(toPorts, rand);
      let result: unknown;
      expect(() => {
        result = canConnect(graph, from, to, port, toPort);
      }).not.toThrow();
      expect(typeof result).toBe('boolean');
    }
  });

  it('canReconnect returns a boolean and never throws for any edge/id/port combination', () => {
    const rand = mulberry32(2);
    const edgePool = [...graph.edges.map((e) => e.id), ...alienIds];
    for (let i = 0; i < 5000; i++) {
      const edgeId = pick(edgePool, rand);
      const from = pick(idPool, rand);
      const to = pick(idPool, rand);
      const port = pick(ports, rand);
      const toPort = pick(toPorts, rand);
      let result: unknown;
      expect(() => {
        result = canReconnect(graph, edgeId, from, to, port, toPort);
      }).not.toThrow();
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('graph-wiring — modifier (mod) port scoping', () => {
  /** trigger → play, with a Trail modifier node and a container, all unwired. */
  function modGraph(): TriggerGraph {
    return {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('play', 'p1', 200, 0),
        makeNode('modifier', 'm1', 100, 100, { modifierId: 'trail' }),
        makeNode('modifier', 'm2', 100, 200, { modifierId: 'trail' }),
        makeNode('all', 'a1', 100, 300),
      ],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    };
  }

  it('accepts a mod wire from a modifier node into a play node', () => {
    expect(canConnect(modGraph(), 'm1', 'p1', undefined, 'mod')).toBe(true);
  });

  it('accepts a mod→mod chain wire', () => {
    expect(canConnect(modGraph(), 'm1', 'm2', undefined, 'mod')).toBe(true);
  });

  it('rejects a mod wire from a NON-modifier source (scoped handles)', () => {
    expect(canConnect(modGraph(), 'a1', 'p1', undefined, 'mod')).toBe(false); // container → mod
    expect(canConnect(modGraph(), 'trigger', 'p1', undefined, 'mod')).toBe(false);
  });

  it('rejects a mod wire into a node with no mod input (a container)', () => {
    expect(canConnect(modGraph(), 'm1', 'a1', undefined, 'mod')).toBe(false);
  });

  it("accepts a modifier's output on an effect-flow wire", () => {
    expect(canConnect(modGraph(), 'm1', 'p1')).toBe(true);
    expect(canConnect(modGraph(), 'm1', 'a1')).toBe(true);
  });

  it('accepts a trigger-flow wire into a modifier node', () => {
    expect(canConnect(modGraph(), 'trigger', 'm1')).toBe(true);
    expect(canConnect(modGraph(), 'a1', 'm1')).toBe(true);
  });

  it('flow `in` and `mod` inputs on one node are distinct — not duplicates of each other', () => {
    const g = modGraph();
    g.edges.push({ id: 'e2', from: 'm1', to: 'p1', toPort: 'mod' });
    // an identical mod wire is a dup...
    expect(canConnect(g, 'm1', 'p1', undefined, 'mod')).toBe(false);
    // ...but the flow input is a different port entirely; flow duplicate detection still
    // keys on the canonical in-port aliases.
    const g2 = modGraph();
    g2.edges.push({ id: 'e3', from: 'trigger', to: 'p1', toPort: 'in' });
    // trigger→p1 already exists on flow 'in' (e1 has undefined toPort ≡ 'in') → dup
    expect(canConnect(g2, 'trigger', 'p1')).toBe(false);
  });

  it('reconnecting an edge onto the mod port validates against source kind', () => {
    const g = modGraph();
    g.edges.push({ id: 'e2', from: 'm1', to: 'p1', toPort: 'mod' });
    // repoint the mod wire to m2's mod input (mod→mod) — legal
    expect(canReconnect(g, 'e2', 'm1', 'm2', undefined, 'mod')).toBe(true);
    // repoint the trigger-flow edge onto a mod port — illegal (trigger isn't a modifier)
    expect(canReconnect(g, 'e1', 'trigger', 'p1', undefined, 'mod')).toBe(false);
  });
});

describe('graph-wiring — modulation (param) port scoping', () => {
  /** trigger → play + modifier, with an envelope source node, all unwired. */
  function modulGraph(): TriggerGraph {
    return {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('play', 'p1', 200, 0),
        makeNode('modifier', 'm1', 100, 100, { modifierId: 'trail' }),
        makeNode('envelope', 'env1', 0, 200),
        makeNode('all', 'a1', 100, 300),
      ],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    };
  }

  it('accepts an envelope → play param row wire', () => {
    expect(canConnect(modulGraph(), 'env1', 'p1', undefined, 'param:brightness')).toBe(true);
  });

  it('accepts an envelope → modifier param row wire', () => {
    expect(canConnect(modulGraph(), 'env1', 'm1', undefined, 'param:decayMs')).toBe(true);
  });

  it('rejects a modulation wire from a NON-source node (scoped handles)', () => {
    expect(canConnect(modulGraph(), 'trigger', 'p1', undefined, 'param:brightness')).toBe(false);
    expect(canConnect(modulGraph(), 'm1', 'p1', undefined, 'param:brightness')).toBe(false); // modifier isn't a mod source
  });

  it('rejects a modulation wire into a node with no params (a container)', () => {
    expect(canConnect(modulGraph(), 'env1', 'a1', undefined, 'param:brightness')).toBe(false);
  });

  it("rejects an envelope's output on a trigger-flow wire (source only feeds param ports)", () => {
    expect(canConnect(modulGraph(), 'env1', 'p1')).toBe(false); // no toPort = flow wire
    expect(canConnect(modulGraph(), 'env1', 'a1')).toBe(false);
  });

  it('rejects a trigger-flow wire INTO an envelope node (source takes no flow input)', () => {
    expect(canConnect(modulGraph(), 'trigger', 'env1')).toBe(false);
    expect(canConnect(modulGraph(), 'a1', 'env1')).toBe(false);
  });

  it('flow, mod and param inputs on one node are distinct ports (not mutual duplicates)', () => {
    const g = modulGraph();
    g.edges.push({ id: 'e2', from: 'env1', to: 'p1', toPort: 'param:brightness' });
    expect(canConnect(g, 'env1', 'p1', undefined, 'param:brightness')).toBe(false); // exact dup
    expect(canConnect(g, 'env1', 'p1', undefined, 'param:size')).toBe(true); // a different row is fine
  });

  it('two envelopes may drive the same param row (they sum at render)', () => {
    const g = modulGraph();
    g.nodes.push(makeNode('envelope', 'env2', 0, 400));
    g.edges.push({ id: 'e2', from: 'env1', to: 'p1', toPort: 'param:brightness' });
    expect(canConnect(g, 'env2', 'p1', undefined, 'param:brightness')).toBe(true);
  });
});

describe('graph-wiring validation — targeted verdicts (no throw)', () => {
  it('rejects self-connects, unknown ids, and cross-graph ids', () => {
    expect(canConnect(graph, 'r1', 'r1')).toBe(false); // self
    expect(canConnect(graph, 'ghost', 'p1')).toBe(false); // unknown source
    expect(canConnect(graph, 'r1', 'ghost')).toBe(false); // unknown target
    expect(canConnect(graph, 'nope-a', 'nope-b')).toBe(false); // both cross-graph
    expect(canConnect(graph, '__proto__', 'p1')).toBe(false); // prototype-key id
  });

  it('rejects wiring out of a sink or into a source-only node (direction)', () => {
    expect(canConnect(graph, 'p1', 'r1')).toBe(false); // play has no output
    expect(canConnect(graph, 'r1', 'trigger')).toBe(false); // trigger has no input
  });

  it('accepts a legal new wire and a legal reconnect', () => {
    expect(canConnect(graph, 'trigger', 't1')).toBe(true); // trigger → toggle
    expect(canReconnect(graph, 'e2', 'r1', 't1')).toBe(true); // repoint e2's target r1 → t1
  });

  it('rejects an exact duplicate wire but allows different bands to the same child', () => {
    const g: TriggerGraph = {
      nodes: [
        makeNode('switch', 's1', 0, 0, { on: 'value', valueMode: 'bands', bands: [0.3, 0.6] }),
        makeNode('play', 'p1', 100, 0),
      ],
      edges: [{ id: 'e1', from: 's1', to: 'p1', fromPort: 'band-0' }],
    };
    expect(canConnect(g, 's1', 'p1', 'band-0')).toBe(false); // exact (source-port → target) dup
    expect(canConnect(g, 's1', 'p1', 'band-1')).toBe(true); // different band, same child is fine
  });

  it('rejects a wire that would form a cycle, without throwing', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('random', 'a', 0, 0), makeNode('random', 'b', 100, 0)],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
    };
    expect(canConnect(g, 'b', 'a')).toBe(false); // would create an a↔b cycle
  });

  it('canReconnect rejects an unknown edge id without throwing', () => {
    expect(canReconnect(graph, 'no-such-edge', 'r1', 't1')).toBe(false);
  });
});

// Item 1.2 hardening: every alias of "the default port" ('', 'in', null-ish) must hit the
// SAME duplicate slot — a differently-spelled duplicate can't slip past the dedup guard.
describe('duplicate detection over canonical ports', () => {
  it('rejects a duplicate spelled with alias ports', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('random', 'r1', 100, 0)],
      edges: [{ id: 'e1', from: 'trigger', to: 'r1', fromPort: '', toPort: 'in' }],
    };
    expect(canConnect(g, 'trigger', 'r1')).toBe(false); // undefined ports ≡ ''/'in'
    expect(canConnect(g, 'trigger', 'r1', '', 'in')).toBe(false); // same spelling
    expect(canConnect(g, 'trigger', 'r1', undefined, 'in')).toBe(false); // mixed
  });

  it('canReconnect applies the same canonical-port dedup', () => {
    const g: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('random', 'r1', 100, 0),
        makeNode('toggle', 't1', 100, 100),
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'r1', toPort: 'in' },
        { id: 'e2', from: 'trigger', to: 't1' },
      ],
    };
    // repointing e2 onto r1's default input duplicates e1 (spelled 'in') → reject
    expect(canReconnect(g, 'e2', 'trigger', 'r1')).toBe(false);
  });

  it('normalizeFromPort / normalizeToPort collapse the aliases', () => {
    expect(normalizeFromPort('')).toBeUndefined();
    expect(normalizeFromPort(null)).toBeUndefined();
    expect(normalizeFromPort('band-1')).toBe('band-1');
    expect(normalizeToPort('in')).toBeUndefined();
    expect(normalizeToPort(undefined)).toBeUndefined();
    expect(normalizeToPort('mod')).toBe('mod');
    expect(normalizeToPort('param:brightness')).toBe('param:brightness');
  });
});
